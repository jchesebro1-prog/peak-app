# Catalog beta build-out: seeding, categories, connections + wire types, attachments

**Wave 1 · beta-blocking.** Authored off-mini 2026-07-25; all Jeff decisions
locked via pop-in questions. Sources: staged punch item (catalog build-out),
`sess-2026-07-24-price-sheet-import`, 2026-07-25 remaining-items brainstorm.

## Problem
Beta testers don't have enough real items to exercise the app ("it is becoming
a problem for beta testing to not have more items" — Jeff). The Grid can't be
the design home with a thin palette, the dashboard trade split needs
categories, and the client package needs attachments. One pass through the
catalog fixes all four.

## Locked decisions
1. **Six beta categories:** Lighting Controls · Fixtures · Video Controls ·
   Speakers · Audio Controls · Curtains. **Fabric explicitly EXCLUDED** —
   Jeff wants a separate discussion (entangled with FABLIB/catalog non-join
   and curtain pricing; do not touch).
2. **Seed a STARTER SET, not all 52 brand sheets.** Claude drafts the starter
   list per category from `~/Downloads/Dealer Price Sheets/Peak Import/`
   (manifest `_CONVERSION-MANIFEST.md`) + Peak's known lines; **Jeff reviews
   the list before import.** Standing calls: Tannoy = Music Tribe source;
   Ape Riggers DROPPED; Draper base-only.
   Anchor brands to start the draft (verify against the manifest): ETC
   (Lighting Controls + Fixtures — Peak is an ETC dealer), Chauvet
   Professional (Fixtures; cross-ref matrices exist), Tannoy (Speakers),
   Draper (Video), plus whatever the manifest holds for Audio Controls and
   Curtains/track. "Some items from different manufacturers" per category is
   the bar — breadth over depth.
3. **Category → trade rollup (Jeff-confirmed): Lighting / Rigging / AV.**
   | Category | Trade |
   |---|---|
   | Lighting Controls, Fixtures | Lighting |
   | Video Controls, Speakers, Audio Controls | AV |
   | Curtains (+ track, hoists, rigging hardware) | Rigging |
   Store the mapping as data (admin-editable), not code — the dashboard
   capacity widget consumes it.
4. **Connection + wire-type metadata** so The Grid can wire devices only when
   compatible, and routed runs can emit cable BOM lines. Extends the queued
   **ETC metadata worksheet** (Claude drafts, Jeff reviews) to all six
   categories.
5. **Datasheet + spec attachments anchor on the catalog part** (not the Grid
   instance). Storage = the private Vercel Blob store + authenticated proxy
   (D116 pattern). Attach once → Grid drops, estimates, designs inherit.
   Spec text side stays the D94/D89 model (hard-coded CSI language on parts).

## Data model (verify shapes in Task 0)
- `catalog_parts` additions: `category` (one of the six), `trade` (derived via
  mapping, overridable), `ports: Port[]`, `datasheetBlobKey?`, `specKey?`
  (link into the D94 spec-content store, whatever shape D94 landed).
- `Port = { name, direction: 'in'|'out'|'io', connectionType, count }`.
- `wire_types` registry: `{ id, label, connectionTypes: string[],
  cableSku?, dollarsPerFt? }` — joins a connection to a purchasable cable.
- **Draft connection-type taxonomy for the worksheet** (Claude-drafted; Jeff
  prunes): power — powerCON/True1, Edison, stage pin, Socapex, bare-end;
  lighting data — DMX512 (5-pin XLR), sACN/Art-Net (etherCON/Cat6), RDM
  (flag on DMX), contact closure; audio — XLR line/mic, speakON NL2/4/8,
  Dante/AES67 (Cat6), AES/EBU, 70V pair; video — HDMI, SDI/BNC, HDBaseT
  (Cat6a), fiber; rigging — motor power, low-voltage pendant control.
- Compatibility rule v1: wire A→B allowed iff `connectionType` matches and
  directions complement (out→in, io↔anything). No signal-chain validation
  beyond that in v1.

## Build tasks
0. **Recon:** document the bulk-importer column schema (the known blocker —
   sheets are faithful vendor layouts, NOT normalized); confirm
   `catalog_parts` shape, D94 spec-content shape, D116 blob helpers.
1. Importer mapping + starter-set import (per-brand mapping notes into the
   manifest).
2. `category`/`trade` fields + admin mapping editor + backfill for the
   already-imported 10,729 parts where inferable (else uncategorized bucket).
3. Ports + wire-type registry + metadata worksheet round-trip (draft → Jeff
   review → import).
4. Blob-backed datasheet upload on catalog part + inherit-and-display in Grid
   palette/BOM rows.
5. Grid palette: surface the six categories (search/filter already exists).

## Open questions
- Starter-set brand list per category = **Jeff review gate** (Task 1 input).
- Where rigging hardware (track/hoists) lives today — category "Curtains" vs
  a hidden seventh bucket; Task 0 decides, mapping table absorbs it.

## Acceptance
Beta user can: find real items from ≥2 manufacturers in every category; drop
them in The Grid; wire two compatible devices (and be refused on
incompatible); see a datasheet from a Grid BOM row; every seeded part carries
category + trade.
