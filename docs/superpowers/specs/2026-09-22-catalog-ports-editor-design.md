# Making Peak's catalog wireable — a ports editor, then a curated draft

- **Date:** 2026-09-22
- **Punch:** #158
- **Decisions:** D187–D191 (allocated below)
- **Status:** approach approved by Jeff 2026-09-22 (editor first, then a curated
  draft for eight named manufacturers); this spec awaits his review
- **Builds on:** punch #39 (catalog build-out + Grid connection logic + wire
  types — INFRA DONE 2026-07-25, IMPORT AWAITS JEFF), D110 (wire routing),
  D186 (Grid options)

---

## 1. The problem

The Grid can only wire devices that carry `ports[]`. Measured against the live
catalog on 2026-09-22:

| | |
|---|---|
| catalog parts (not deleted) | **14,725** |
| **with `ports[]` — i.e. wireable** | **55 (0.37%)** |
| with a datasheet attached | **0** |
| distinct categories | 396 |
| distinct manufacturers | 66 |

The 55 are exactly the #39 starter set — Speakers 14, Lighting Controls 11,
Video Controls 11, Fixtures 10, Audio Controls 6, Curtains 3. Every other
category, including the four largest (Audio 4,636 · AV Infrastructure 1,454 ·
AV 680 · AV Distribution 631), has **zero** ported parts.

**The engine is not the problem.** #39 shipped all of it: `ports[]` on parts, a
22-entry `CONNECTION_TYPES` taxonomy, a wire-type registry, `canConnect`,
`compatibleWireTypes`, `validateDeviceWire`, endpoint snapping on routes
(`GridRoute.fromPlacementId`/`toPlacementId`), client- AND server-side refusal
of incompatible pairs, and cable BOM lines carrying the connection type. It
works. It has almost nothing to work on.

**And nothing can write ports but a script.** There is no ports control in
`PartFormModal` (`src/app/(app)/catalog/page.tsx:569`) and none anywhere else
in the UI. `upsertPart` doesn't read or write the field. So today a wrong port,
or a missing one, needs a developer and a deploy.

## 2. Why the DaVinci library is not the answer

`promote-sales-compliance` proposed importing a DaVinci export
(`data/davinci/`, 116 MB, 2026-09-02) to supply ports at scale. It is a real,
rich library: 2,366 device types, **1,381 of them with ports**, 56 port
protocols, 25 connector types, 2,122 symbol images.

**It does not intersect Peak's catalog.** Verified four independent ways:

1. Model-number prefixes among ported types are ETC product lines — RSN, ARCP,
   SELD, ETR, ECPB, ERN.
2. The only manufacturer-bearing property among 455 property types has choices
   like "ETC Rep".
3. Brute force: every one of the 17,831 identifier-shaped strings in the 42 MB
   `library.json`, matched against all 14,725 SKUs (brand prefix split off,
   punctuation collapsed) → **9 matches**, 8 ETC and one false positive
   (`QSC:SP-36` ↔ `SP3-6`).
4. Brand names across 316,115 human-readable strings (excluding the base64
   image/script blobs, which produce false hits): `ETC 1606`, and **zero** for
   Shure, Biamp, JBL, RCF, EAW, QSC, Chauvet, Symetrix, Bose, Listen, AKG. The
   2,855 "Williams" hits are `justin williams`, the library's author — not
   Williams AV.

Peak stocks **10 ETC parts**. The catalog is Shure (1,303), Biamp (1,148), JBL
(822), RCF (597), EAW (556), AVPro Edge (460), QSC (389), Chauvet (382).
Importing this library would add ~1,381 **unpriced ETC devices Peak does not
sell** while leaving all 14,725 real parts exactly as unwireable as before.

Jeff confirmed 2026-09-22 that this is the full export available to him.

**D187 — the DaVinci ETC library is not imported.** Ports for Peak's catalog
are curated, not sourced from it. Recorded so this is not re-litigated: the
analysis above is cheap to repeat and was repeated twice already.

## 3. Goals

1. Anyone who can edit a catalog part can give it ports, and fix a wrong one,
   without a developer.
2. The devices Peak actually places carry accurate ports, so the Grid's
   existing validation and cable BOM do real work.

### Non-goals

- Touching the wiring engine, `CONNECTION_TYPES`, wire types, or the Grid
  canvas. All shipped under #39/D110 and all working.
- Porting anything from `promote-sales-compliance` (its wire commits
  re-implement shipped #39 infrastructure against a Grid main has since
  rebuilt twice).
- Datasheet extraction from manufacturer PDFs. A large build with poor
  per-manufacturer consistency; revisit only if curation proves too slow.
- Enriching all 14,725 parts. Scope is "the models Peak actually places"
  (Jeff, 2026-09-22) — a few hundred, not the whole book.
- The 8 ETC parts that *do* match DaVinci. Too few to justify a pipeline; they
  go through the editor like anything else.

---

## 4. Phase 1 — the ports editor

### 4.1 Where it lives

A **Ports** section inside the existing `PartFormModal`. That modal is a server
component rendering a plain `<form action={upsertPart}>` that works without
JavaScript, and it stays that way: the ports section is a **small client
island**, because adding and removing rows genuinely requires interactivity —
the AGENTS.md bar for reaching for a client component.

The island renders the rows and keeps them in one **hidden input** (`ports`,
JSON). `upsertPart` stays a flat FormData action: it parses that field,
validates it, and passes `ports` to `mergeUpsert`. `CatalogPart.ports?: Port[]`
already exists and `mergeUpsert` takes `Partial<Omit<CatalogPart, …>>`, so
**there is no store or schema change** — the #39 importer writes this same
field today.

**One subtlety worth stating, because it is exactly the kind that bites.**
`mergeUpsert` is `{ ...existing, ...patch }`: *"a key present in `patch` always
wins … a key simply absent from `patch` leaves the existing value in place."*
Today `upsertPart` never sends `ports`, so an ordinary price edit correctly
leaves them untouched. Once the form owns ports it must send the field on
**every** save, including an empty array — otherwise deleting a part's last
port would silently leave the old ports in place, and the part would keep
wiring in a way the UI says it cannot.

**D188 — ports are edited through a client island serializing to one hidden
JSON field**, not through indexed FormData names (`port.0.name`, …). Indexed
names would keep the no-JS purity but make "add a row" a server round trip, and
a device with eight ports is ordinary.

### 4.2 The row model

Each row is the existing `Port` type from `src/lib/catalog-connect.ts`, unchanged:

```ts
type Port = { name: string; direction: "in" | "out" | "io"; connectionType: string; count?: number };
```

- **name** — free text ("DMX In", "Audio in", "Dimmed Power Out").
- **direction** — a three-way control; `io` for bidirectional (network, RDM).
- **connectionType** — a `<select>` over `CONNECTION_TYPES`.
- **count** — optional, defaults to 1. "12 × stage pin" is one row, matching
  how the #39 draft worksheet already expresses multi-port devices.

### 4.3 The load-bearing constraint

**`connectionType` is selected from `CONNECTION_TYPES`, never typed.**
`validateDeviceWire` and `compatibleWireTypes` both resolve against that
22-entry taxonomy. A typo would not merely look wrong — it would make the
device silently unwireable against everything, with no error anywhere, which is
the same class of failure as a confidently-wrong geocode.

The server **re-checks membership** and rejects unknown values rather than
trusting the client, because the hidden field is user-editable in the DOM.
Invalid rows fail the save with a message; they are never silently dropped.

**D189 — connection types are a closed vocabulary at every layer.** The select
constrains, the server validates, and neither trusts the other.

### 4.4 Permissions

Editing ports requires `requireUser()` — the same bar as editing a part's price
or description. Ports are ordinary catalog data, and the point of this work is
that the team can make a device wireable without a developer.

Deliberately *not* admin-gated, unlike datasheet attach (which writes to blob
storage) and the Categories & trades card (which rewrites a shared taxonomy).
Ports are per-part and correctable in place.

**D190 — ports are user-editable, not admin-gated.** Reversible in one line if
Jeff would rather restrict it; flagged here because it is arguable, since ports
do feed quote validation and the cable BOM.

### 4.5 Visibility

Parts with ports are already surfaced — the Grid palette shows them and
`grid/[id]/page.tsx` passes `ports` through to `PartLite`. The one addition is
a **ports count on the catalog row**, so "which of my parts are wireable" is
answerable by looking rather than by running a script.

---

## 5. Phase 2 — a ports rules engine (separate spec)

**Correction, 2026-09-22.** An earlier draft of this spec described
`scripts/draft-starter-set.ts` as a drafting engine that "has only ever been
run across 68 items". That is wrong, and the error is recorded here because it
changed a decision. The script is a **hand-curated pick list**:

```ts
{ sku: "ETC:ION XE 2K-US", ports: consolePorts() },
{ sku: "ETC:D20AF", ports: dimmerRackPorts(2),
  portNote: "(verify — dimmed-output connector depends on host rack)" },
```

A human chose each of the 68 SKUs and read each description to pick a port
shape from helpers like `consolePorts()` / `poweredSpeakerPorts()` /
`matrixPorts(inN, outN)`. There is no manufacturer filter to point at more
brands — the picks *are* the content. "Extending it to eight manufacturers"
would mean hand-writing several hundred `{ sku, ports }` entries against
price-sheet descriptions, which is the same manual work as the editor with
worse domain knowledge.

**Phase 2 is therefore a ports rules engine, and it gets its own spec**
(Jeff, 2026-09-22): description/category → port shape, with a confidence flag
per row, applied across the catalog and re-runnable as the rules improve. It
is deliberately designed *after* Phase 1 ships, so the rules can be derived
from the shapes that actually recur in the models Peak places rather than from
guesses.

**D191 — the bulk pass is a re-runnable rules engine producing review
worksheets, never a direct import**, and everything it produces stays
correctable in-app afterwards. #39's "Jeff reviews before import" gate holds.

---

## 6. Testing

- **Unit:** the `ports` JSON round-trip (serialize → parse → equal); rejection
  of a `connectionType` outside `CONNECTION_TYPES`; `count` defaulting; an
  empty ports array clearing a part's ports rather than leaving them stale.
- **Integration:** on a scratch PGlite datadir, save a part with ports through
  `upsertPart` and assert `mergeUpsert` persisted them; then assert
  `validateDeviceWire` **accepts** a matching in/out pair on that connection
  type and **refuses** a mismatched one. That second assertion is the one that
  proves the feature reaches the wiring engine instead of merely storing data.
- **Tamper case:** a hand-edited hidden field carrying an unknown connection
  type is rejected server-side.
- **Gates:** tsc · eslint against a baseline · `test:specs` · `test:smoke`,
  reported with real numbers.
- **Browser check:** add two ports to a real part, then wire those devices in
  the Grid and confirm the route stamps `connectionType` and the cable BOM line
  carries it.

---

## 7. Open items for Jeff

1. Review this spec.
2. Confirm the permissions call in §4.4 (user-editable vs admin-only).
3. After Phase 1 ships: add ports to your go-to models, which becomes the
   ground truth the Phase 2 rules engine is designed against.
4. The July review artifacts — `docs/catalog/STARTER-SET-2026-07-DRAFT.md` (68
   items) and `METADATA-WORKSHEET-2026-07.md` — are still awaiting the read
   they were written for. Phase 2 extends them rather than replacing them.
