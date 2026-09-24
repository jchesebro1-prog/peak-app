# DaVinci → catalog enrichment (#162) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write manufacturer-authored ports and datasheet links onto the 2,917 production catalog rows that match a DaVinci entry carrying either, without creating a row or touching a price.

**Architecture:** A pure mapping layer (`src/lib/davinci/*`) turns DaVinci's UUID-referenced port records into Peak `Port[]`. A build step distils the 116 MB library into a 0.52 MB committed extract. A single writer module plans and applies enrichment against the catalog doc-store. A CLI reports, dry-runs, then commits behind the repo's two-flag hosted gate.

**Tech Stack:** TypeScript, Next.js 16 App Router, Drizzle over Postgres (prod: Neon; dev: PGlite), `tsx` scripts, assertions via `ok()` in `scripts/test-review-and-spec.ts`.

**Spec:** `docs/superpowers/specs/2026-09-23-davinci-etc-catalog-enrichment-design.md`

## Global Constraints

These apply to every task. Violating any one of them fails the task's review.

- **Never open `.data/pglite` while another process may hold it.** PGlite is single-process and opening it runs `migrate()`, which is a write. This has destroyed the dev DB three times. Use `PGLITE_PATH=$(mktemp -d)`. Check `ps aux | grep -E "tsx|next dev"` before any script run.
- **Never run `git stash`.** One stash is shared across all worktrees in this repo and has destroyed other agents' uncommitted work. Commit instead.
- **Never leave a `tsx` process running.**
- **Preview and production share one Neon database.** Any hosted write is live. No task in this plan writes to a hosted database; the operator does that by hand at the end.
- **Never write `list`, `cost` or `pricedAt`.** This feature has no opinion on price.
- **Never create or delete a catalog row.** Enrichment only patches rows that already exist.
- Node lives at `~/.local/node/bin`. `export PATH="$HOME/.local/node/bin:$PATH"` first.
- The four gates, run against a `git stash`-free baseline: `npx tsc --noEmit`, `npm run test:specs`, `npm run test:smoke`, `npx eslint`. Report real numbers, never "should pass".
- Source data lives at `data/davinci/source/<timestamp>/library.json` (116 MB, gitignored). It exists on this machine only. Never commit it, never move it.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/davinci/sku.ts` | `normalizeSku` — the one normalizer, shared by extract and match |
| `src/lib/davinci/protocol-map.ts` | UUID → Peak connection type. Hand-written, reviewed, exhaustive |
| `src/lib/davinci/types.ts` | `DavinciRecord`, `DavinciDoc` |
| `src/lib/davinci/extract.ts` | `library.json` → `DavinciRecord[]` |
| `src/lib/davinci/match.ts` | index + lookup |
| `src/lib/davinci/load.ts` | reads the committed extract (the only `node:fs` in the layer) |
| `src/lib/catalog-davinci-apply.ts` | the only module that writes |
| `scripts/davinci-extract.ts` | regenerates the committed extract |
| `scripts/davinci-enrich.ts` | report / dry-run / commit CLI |
| `data/davinci-extract.json` | 0.52 MB committed artifact |
| `src/lib/catalog-connect.ts` | *modify* — new connection types + wire types |
| `src/lib/stores/catalog.ts` | *modify* — `docs?`, `davinci?` on `CatalogPart` |
| `scripts/test-review-and-spec.ts` | *modify* — all assertions |

---

### Task 1: The SKU normalizer

The two catalogs disagree on SKU format and this is the single highest-risk
detail in the feature. Local dev writes `ETC:ION XE 2K-US`; production writes
`ION XE 2K-US`; DaVinci writes model number `ION XE 2K-US` and part number
`7150A1121`. A normalizer that does not strip the `MFR:` prefix matches
production and silently misses every row in dev — which is where this gets
developed and tested.

**Files:**
- Create: `src/lib/davinci/sku.ts`
- Test: `scripts/test-review-and-spec.ts` (append a `#162` section)

**Interfaces:**
- Consumes: nothing
- Produces: `normalizeSku(s: string): string`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/test-review-and-spec.ts`. Add the import alongside the others at the top:

```ts
import { normalizeSku } from "@/lib/davinci/sku";
```

Then append at the end of the file:

```ts
/* ====== #162 DaVinci enrichment — SKU normalizer ====== */
ok(normalizeSku("ETC:ION XE 2K-US") === "IONXE2KUS", "#162 a MFR: prefix is stripped before normalizing");
ok(normalizeSku("ION XE 2K-US") === "IONXE2KUS", "#162 a bare production SKU normalizes to the same key");
ok(normalizeSku("ETC:ION XE 2K-US") === normalizeSku("ION XE 2K-US"), "#162 dev and prod spellings of one part agree");
ok(normalizeSku("IRWLZ-30/80-120-C-DALI-1") === "IRWLZ3080120CDALI1", "#162 slashes and dashes are dropped");
ok(normalizeSku("  arcp1s360wy  ") === "ARCP1S360WY", "#162 case and surrounding space are normalized");
ok(normalizeSku("") === "", "#162 an empty SKU normalizes to empty, not to a match-everything key");
ok(normalizeSku("::::") === "", "#162 a SKU that is only separators normalizes to empty");
// A colon INSIDE the model number must not eat the real identifier.
ok(normalizeSku("Allen & Heath:AH-DLIVE-CDM32-RUFX") === "AHDLIVECDM32RUFX", "#162 only the first prefix segment is dropped");
```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH="$HOME/.local/node/bin:$PATH" && npm run test:specs 2>&1 | tail -20
```

Expected: a module-resolution failure on `@/lib/davinci/sku`.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * The one SKU normalizer for DaVinci matching (#162).
 *
 * Peak's two catalogs disagree on SKU format: local dev writes a
 * manufacturer-prefixed id (`ETC:ION XE 2K-US`, the shape `scripts/import-catalog.ts`
 * produces), production writes the bare model number (`ION XE 2K-US`, the shape the
 * dealer-sheet importer produces). DaVinci writes bare model and part numbers.
 * Matching literally would work against production and silently miss every row in
 * dev, which is where this feature is developed — so the prefix comes off first.
 *
 * Extract and match MUST share this function. `scripts/daylite-ids.ts` exists for
 * the same reason: an id convention duplicated in two places drifts, and the drift
 * is invisible until a whole import matches nothing.
 */
export function normalizeSku(s: string): string {
  const raw = String(s ?? "").trim();
  // Drop a leading `MFR:` segment only — a colon later in the string is part of
  // the identifier and must survive into the key.
  const i = raw.indexOf(":");
  const body = i >= 0 ? raw.slice(i + 1) : raw;
  return body.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
export PATH="$HOME/.local/node/bin:$PATH" && npm run test:specs 2>&1 | tail -5
```

Expected: `PASS` count up by 8, `0 FAIL`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/davinci/sku.ts scripts/test-review-and-spec.ts
git commit -m "feat(davinci): the shared SKU normalizer, prefix-aware (#162)"
```

---

### Task 2: The protocol map

**Files:**
- Create: `src/lib/davinci/protocol-map.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `PortDirection` from `@/lib/catalog-connect`
- Produces:
  - `PROTOCOL_MAP: Readonly<Record<string, ProtocolMapping>>`
  - `DIRECTION_MAP: Readonly<Record<string, PortDirection>>`
  - `mapProtocol(protocolId: string, connectorLabel: string): { connectionType: string } | { excluded: string }`
  - `PASSTHROUGH_TYPES: readonly string[]` — every `kind: "passthrough"` value, for Task 7

This file is the review artifact. Jeff reads it, not the parts — the same
contract `PORT_RULES` had in #159.

- [ ] **Step 1: Write the failing tests**

Import:

```ts
import { PROTOCOL_MAP, DIRECTION_MAP, mapProtocol, PASSTHROUGH_TYPES } from "@/lib/davinci/protocol-map";
```

Append:

```ts
/* ====== #162 protocol map ====== */
ok(Object.keys(PROTOCOL_MAP).length === 56, "#162 every one of DaVinci's 56 protocols is mapped explicitly");

// An unknown protocol must fail loudly, never default to something plausible.
let threw162 = false;
try { mapProtocol("00000000-0000-0000-0000-000000000000", "RJ45 Female"); } catch { threw162 = true; }
ok(threw162, "#162 an unmapped protocol UUID throws rather than guessing a connection type");

// D2 — the four NewPortProtocol entries are four different protocols.
const arc162 = [
  "a39a614e-3592-48f8-81d5-5d26a1d09e86",
  "a9f1dd53-e35a-439a-b4d4-898408b208f4",
  "ce5efb79-1a6b-4419-b597-2883291b6fad",
].map((id) => mapProtocol(id, "Molex Thru"));
const arcTypes162 = arc162.map((r) => ("connectionType" in r ? r.connectionType : "EXCLUDED"));
ok(new Set(arcTypes162).size === 3, "#162 the three ARCSYSTEM protocols stay three distinct connection types");
ok(
  "excluded" in mapProtocol("1660207c-f71c-492e-9978-ad1e3859b8cc", "Ethercon Male"),
  "#162 the blank fourth NewPortProtocol (RouteStubPrototype only) is excluded"
);

// The ten F-DRIVE protocols must not collapse either.
const fdrive162 = [
  "e4699b60-48e4-491b-8b8d-c0c90bff073e", "3b247b12-0139-4755-9303-986fd7f147e4",
  "9f1f7378-5890-4e8f-9e0f-a746d696e0d7", "39f8e3dc-6877-4d84-81e4-8db395a72eba",
  "c6ad45b9-e2d6-4a9e-95ac-d3c4fd63dd7d", "e1c07a88-547d-43bd-9c6c-bb230ad94de7",
].map((id) => mapProtocol(id, "RJ45 Female")).map((r) => ("connectionType" in r ? r.connectionType : "X"));
ok(new Set(fdrive162).size === 6, "#162 the F-DRIVE protocols do not collapse into one connection type");

// D3/D4 — power is the only place the connector refines the answer.
const POWER162 = "aa07559e-6609-4ec6-8df3-8990d6bc9909";
const ct162 = (id: string, c: string) => { const r = mapProtocol(id, c); return "connectionType" in r ? r.connectionType : "EXCLUDED"; };
ok(ct162(POWER162, "powerCON In") === "powerCON/True1", "#162 a powerCON connector resolves power to powerCON/True1");
ok(ct162(POWER162, "powerCON TRUE1 Male") === "powerCON/True1", "#162 TRUE1 resolves to powerCON/True1");
ok(ct162(POWER162, "Terminal Block") === "bare-end", "#162 a hardwired connector resolves power to bare-end");
ok(ct162(POWER162, "Screw Terminal") === "bare-end", "#162 screw terminals are bare-end");
ok(ct162(POWER162, "Power") === "line power (unspecified)", "#162 DaVinci's generic Power connector is not guessed as Edison or stage pin");
ok(ct162(POWER162, "") === "line power (unspecified)", "#162 a power port with no connector is unspecified, not bare-end");

// The connector is advisory everywhere else: DMX is DMX on any connector.
const DMX162 = "698f9701-604c-4432-902f-19866c061108";
ok(
  ct162(DMX162, "Terminal Block") === ct162(DMX162, "DMX Female") && ct162(DMX162, "DMX Female") === "DMX512 (5-pin XLR)",
  "#162 DaVinci's dirty connector data never changes a non-power protocol's type"
);

// Directions — Bus and Configurable both become io.
ok(DIRECTION_MAP["Input"] === "in" && DIRECTION_MAP["Output"] === "out", "#162 Input/Output map to in/out");
ok(DIRECTION_MAP["Bidirectional"] === "io", "#162 Bidirectional maps to io");
ok(DIRECTION_MAP["Bus"] === "io", "#162 a Bus port maps to io — it connects in either direction");
ok(DIRECTION_MAP["Configurable"] === "io", "#162 a Configurable port maps to io");
ok(Object.keys(DIRECTION_MAP).length === 5, "#162 all five DaVinci directions are mapped");

ok(PASSTHROUGH_TYPES.length > 0 && PASSTHROUGH_TYPES.every((t) => t.startsWith("ETC ")), "#162 every pass-through type is namespaced so it cannot collide with a Peak type");
```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH="$HOME/.local/node/bin:$PATH" && npm run test:specs 2>&1 | tail -20
```

Expected: module not found.

- [ ] **Step 3: Write the implementation**

Full file. Every UUID below was read out of `library.json` on 2026-09-23; the
trailing comment on each line is `constantName | signalName | port rows | top category`.

```ts
/**
 * DaVinci port protocol → Peak connection type (#162, D1–D4).
 *
 * THIS FILE IS THE REVIEW ARTIFACT. Jeff reads these 56 lines, not the 2,629
 * parts they touch — the same contract `PORT_RULES` had in #159.
 *
 * Keyed on the protocol UUID, never on a name, because neither DaVinci name
 * field is unique (D2): `constantName` "NewPortProtocol" names four distinct
 * protocols (three ARCSYSTEM driver channels plus an internal blank), and
 * `protocolSignalName` is worse — ten protocols share "F-DRIVE", ten share "",
 * five share "POWER". Keying on either silently merges protocols, and a merged
 * protocol makes two devices that cannot physically connect validate as a good
 * wire.
 *
 * `mapProtocol` THROWS on an unknown UUID. A future ETC library revision that
 * adds a protocol must fail the extract loudly rather than quietly mis-typing
 * ports — the #159 `\bamp\b` bug (61 passive speakers given four speakON NL4
 * outputs) is what that rule is defending against.
 */
import type { PortDirection } from "@/lib/catalog-connect";

export type ProtocolMapping =
  /** Resolves to an existing CONNECTION_TYPES entry regardless of connector. */
  | { kind: "peak"; connectionType: string }
  /** Power only (D3/D4): the connector picks between three Peak types. */
  | { kind: "power" }
  /** No Peak equivalent — carried verbatim so it mates only with itself (D1). */
  | { kind: "passthrough"; connectionType: string }
  /** ETC-internal, never a product (D5). */
  | { kind: "exclude"; why: string };

/** DaVinci connector labels that mean a powerCON-family inlet/outlet. */
const POWERCON_CONNECTORS = new Set([
  "powerCON In", "powerCON Thru", "powerCON TRUE1 Male", "powerCON TRUE1 Female",
]);
/** DaVinci connector labels that mean a hardwired termination. */
const HARDWIRED_CONNECTORS = new Set(["Terminal Block", "Screw Terminal", "Flying Leads"]);

export const PROTOCOL_MAP: Readonly<Record<string, ProtocolMapping>> = {
  // ---- power (D4) -------------------------------------------------------
  "aa07559e-6609-4ec6-8df3-8990d6bc9909": { kind: "power" }, // Power | POWER | 2195
  "25636fee-a970-4c76-b5cc-7de92724a664": { kind: "peak", connectionType: "bare-end" }, // Power480V | 26 | hoist feeders, always hardwired
  "ca96a25e-b72f-4bb6-a628-f83dfb1caa83": { kind: "peak", connectionType: "bare-end" }, // Power208V | 21
  "29a18143-da9b-47c9-8b7f-6b1b4d71e696": { kind: "peak", connectionType: "bare-end" }, // Power208VFP | 3
  "e4309323-4f8d-4dc6-9f90-7607696e951b": { kind: "peak", connectionType: "bare-end" }, // Power480VFP | 3
  "1a0f1e55-53a5-452a-8294-9f8fd5c60783": { kind: "power" }, // AuxPowerReciever | AUXILIARY | 72
  "0c508822-833d-4169-b3cf-3fc1bd667947": { kind: "power" }, // AuxiliaryPower | AUXILIARY | 39
  "9c23dfb5-6ec6-4afc-818a-e6de8acf3bcc": { kind: "power" }, // ParadigmAuxiliaryPower | AUXILIARY | 14
  "813d35ed-b976-4c98-bfe6-00ce240b42f9": { kind: "passthrough", connectionType: "ETC F-Drive R12 power supply" }, // F-DriveR12PowerSupply | 2
  "98fd246f-8612-4545-b303-a097beaba911": { kind: "passthrough", connectionType: "ETC F-Drive RX power supply" }, // F-DriveRXPowerSupply | 2

  // ---- the four concepts Peak already has -------------------------------
  "698f9701-604c-4432-902f-19866c061108": { kind: "peak", connectionType: "DMX512 (5-pin XLR)" }, // DMX | 1182
  "9a022b19-7db9-4e5d-a336-c0439b67e480": { kind: "peak", connectionType: "sACN/Art-Net (etherCON/Cat6)" }, // Ethernet | NETWORK | 856
  "4c84a317-13dd-4140-89a4-4ce929c5e185": { kind: "peak", connectionType: "contact closure" }, // ContactIn | 509
  "2a4cde5d-5048-435e-95b0-9563abcb9b37": { kind: "peak", connectionType: "contact closure" }, // RelayOut | 1
  "e93491b6-bee0-4dc9-90a8-42a6350cd601": { kind: "peak", connectionType: "contact closure" }, // EBDKSwitch | SWITCH | 7
  "5adfd0e2-9d39-4731-b767-dffddb09b934": { kind: "peak", connectionType: "contact closure" }, // Emergency | 7
  "ac24def3-73c7-4798-a17f-158833c9989a": { kind: "peak", connectionType: "contact closure" }, // Pabuc | PANIC | 180
  "1edd1d1f-a9a9-475d-a032-1d21b8008454": { kind: "peak", connectionType: "fiber" }, // LHFiber | FIBER | 4
  "7c75f5ae-17f1-4b8d-91af-bede2e61bc8a": { kind: "peak", connectionType: "fiber" }, // SHFiber | 4
  "c8b92083-acad-45ee-aa2c-891e9c7f842f": { kind: "peak", connectionType: "XLR line/mic" }, // Audio | 4

  // ---- rigging: Peak's low-voltage pendant control ----------------------
  "0a1111cc-498a-4e53-9770-7c12593683a4": { kind: "peak", connectionType: "low-voltage pendant control" }, // RiggingE-Stop | 9
  "71f7408b-9193-4b59-9caf-0010d4b9b072": { kind: "peak", connectionType: "low-voltage pendant control" }, // RiggingRemoteController | 9
  "74851fc6-4089-4b3a-a36c-565c3ce4376e": { kind: "peak", connectionType: "low-voltage pendant control" }, // RiggingPresetHandheldRemote | 3
  "d0a64818-3d75-4746-a448-917a98a78fd5": { kind: "peak", connectionType: "low-voltage pendant control" }, // RiggingHandheldRemote | 0

  // ---- pass-through: ETC-proprietary and lighting-specific buses (D1) ---
  "bdbaf758-aaaf-4f21-9230-b139e24b6493": { kind: "passthrough", connectionType: "ETC USB" }, // USB | 247
  "6b7cc342-153a-4269-9b55-aadf70ff6080": { kind: "passthrough", connectionType: "ETC 0-10V dimming" }, // 010V | 226
  "18421f4d-698e-4162-a5be-a8884e16f405": { kind: "passthrough", connectionType: "ETC DALI" }, // DALI | 138
  "f6a6de71-72a5-4c97-b03f-4eb8fc802d98": { kind: "passthrough", connectionType: "ETC Echoflex (wireless)" }, // Echoflex | 105
  "437b2735-7209-4f58-8a53-6edab215d31b": { kind: "passthrough", connectionType: "ETC EchoConnect" }, // EchoConnect | 89
  "3f481bd5-30f9-4c19-834c-495ee89c652c": { kind: "passthrough", connectionType: "ETC EchoConnect (line voltage)" }, // EchoConnectVoltage | 0
  "af166d22-fc60-4de1-8a68-ccd3269f3a8a": { kind: "passthrough", connectionType: "ETC Control/SafetyLink (MCX)" }, // Control/SafetyLink | MCX | 77
  "d52d6521-2159-49b8-92ca-998ce389a746": { kind: "passthrough", connectionType: "ETC LinkConnect" }, // LinkConnect | 66
  "ba088ec1-a2f8-4df4-b283-f840e3865f60": { kind: "passthrough", connectionType: "ETC LinkConnect (Paradigm portable)" }, // ParadigmPortable | 12
  "39c4efdc-03b0-4ca6-9921-278bf63600ce": { kind: "passthrough", connectionType: "ETC LinkConnect (SPS)" }, // SPSConnection | 2
  "f9fe4a69-bb35-428e-acb4-854f993a30f7": { kind: "passthrough", connectionType: "ETC Sense" }, // Sense | 53
  "59e6b9e9-9623-4e9a-bfbd-e4a46bb765a2": { kind: "passthrough", connectionType: "ETC Multiverse (wireless DMX)" }, // Multiverse | 44
  "8a993067-acdf-4267-8392-94c91ccbad13": { kind: "passthrough", connectionType: "ETC BluesSystem low voltage" }, // BluesSystemLV | BLUES | 42
  "ca4d319a-5cbc-4758-a803-49071b02c94f": { kind: "passthrough", connectionType: "ETC MIDI" }, // MIDI | 27
  "c3b79b4e-7cdb-4327-83cb-f4cdc3e237f3": { kind: "passthrough", connectionType: "ETC SMPTE timecode" }, // SMPTE | 9
  "fd40b766-6cc1-49a2-bdc0-7cd3e975257c": { kind: "passthrough", connectionType: "ETC serial" }, // Serial | 8
  "c1eafc85-1bda-422c-a4e2-9c475f1e2f07": { kind: "passthrough", connectionType: "ETC LSH control" }, // LSHControl | LSH | 5
  "dcd25fb0-d5f0-45fe-a5eb-92b914d5ec4e": { kind: "passthrough", connectionType: "ETC control (generic)" }, // Control | 5
  "6f4e34b0-8b6d-4406-9243-bdee2a3eb110": { kind: "passthrough", connectionType: "ETC MeshConnect (wireless)" }, // MeshConnect | 3
  "8e6f701d-f7a8-46c0-af0e-ed81e8c1c994": { kind: "passthrough", connectionType: "ETC CANbus" }, // CANbus | 3

  // ---- pass-through: F-Drive, one type per driver family ----------------
  "e4699b60-48e4-491b-8b8d-c0c90bff073e": { kind: "passthrough", connectionType: "ETC F-Drive CC" }, // FDriveConnectionCC | 57
  "3b247b12-0139-4755-9303-986fd7f147e4": { kind: "passthrough", connectionType: "ETC F-Drive RX CC" }, // FDriveRXConnectionCC | 34
  "9f1f7378-5890-4e8f-9e0f-a746d696e0d7": { kind: "passthrough", connectionType: "ETC F-Drive RX FTW" }, // FDriveRXConnectionFTW | 19
  "39f8e3dc-6877-4d84-81e4-8db395a72eba": { kind: "passthrough", connectionType: "ETC F-Drive FTW" }, // FDriveConnectionFTW | 11
  "c6ad45b9-e2d6-4a9e-95ac-d3c4fd63dd7d": { kind: "passthrough", connectionType: "ETC F-Drive RX CV" }, // FDriveRXConnectionCV | 11
  "e1c07a88-547d-43bd-9c6c-bb230ad94de7": { kind: "passthrough", connectionType: "ETC F-Drive CV" }, // FDriveConnectionCV | 10
  "e246c0e7-39ba-47c3-9bd1-52454b6e9149": { kind: "passthrough", connectionType: "ETC F-Drive Chroma" }, // FDriveConnectionChroma | 9
  "9b6372db-22d6-4690-a41f-89cd5b752575": { kind: "passthrough", connectionType: "ETC F-Drive ARC" }, // FDriveConnectionARC | 3

  // ---- pass-through: ArcSystem drivers, three distinct families (D2) ----
  "a39a614e-3592-48f8-81d5-5d26a1d09e86": { kind: "passthrough", connectionType: "ETC ArcSystem D4 driver" }, // NewPortProtocol | ARCSYSTEM | 21 | D4 Driver CC
  "a9f1dd53-e35a-439a-b4d4-898408b208f4": { kind: "passthrough", connectionType: "ETC ArcSystem D2 driver" }, // NewPortProtocol | ARCSYSTEM | 8 | D2 Driver
  "ce5efb79-1a6b-4419-b597-2883291b6fad": { kind: "passthrough", connectionType: "ETC ArcSystem D1HO driver" }, // NewPortProtocol | ARCSYSTEM | 6 | D1HO Driver CE

  // ---- excluded (D5) ----------------------------------------------------
  "1660207c-f71c-492e-9978-ad1e3859b8cc": { kind: "exclude", why: "blank NewPortProtocol, used only by RouteStubPrototype" }, // 1
};

export const DIRECTION_MAP: Readonly<Record<string, PortDirection>> = {
  Input: "in",
  Output: "out",
  Bidirectional: "io",
  // A DaVinci "Bus" port is a multi-drop tap — it connects in either direction,
  // so "io" is the honest Peak equivalent, not an arbitrary in/out choice.
  Bus: "io",
  Configurable: "io",
};

/** Every pass-through value, for Task 7's CONNECTION_TYPES + wire-type wiring. */
export const PASSTHROUGH_TYPES: readonly string[] = Object.values(PROTOCOL_MAP)
  .filter((m): m is Extract<ProtocolMapping, { kind: "passthrough" }> => m.kind === "passthrough")
  .map((m) => m.connectionType)
  .filter((v, i, a) => a.indexOf(v) === i)
  .sort();

/** Resolve one DaVinci port. Throws on an unmapped protocol — never guesses. */
export function mapProtocol(
  protocolId: string,
  connectorLabel: string
): { connectionType: string } | { excluded: string } {
  const m = PROTOCOL_MAP[protocolId];
  if (!m) {
    throw new Error(
      `#162 unmapped DaVinci protocol ${protocolId}. A library revision has added a protocol: ` +
        `add it to PROTOCOL_MAP (src/lib/davinci/protocol-map.ts) after deciding what it is. ` +
        `Refusing to guess — a wrong connection type silently validates a wire that cannot exist.`
    );
  }
  if (m.kind === "exclude") return { excluded: m.why };
  if (m.kind === "peak" || m.kind === "passthrough") return { connectionType: m.connectionType };
  // power (D4): the connector is the only place DaVinci's connector field is trusted.
  if (POWERCON_CONNECTORS.has(connectorLabel)) return { connectionType: "powerCON/True1" };
  if (HARDWIRED_CONNECTORS.has(connectorLabel)) return { connectionType: "bare-end" };
  return { connectionType: "line power (unspecified)" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
export PATH="$HOME/.local/node/bin:$PATH" && npm run test:specs 2>&1 | tail -5
```

Expected: `0 FAIL`. The `PASSTHROUGH_TYPES` assertion will fail if any
pass-through label was written without the `ETC ` prefix — fix the label, not
the test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/davinci/protocol-map.ts scripts/test-review-and-spec.ts
git commit -m "feat(davinci): UUID-keyed protocol map, throws on unknown (#162, D1-D4)"
```

---

### Task 3: Taxonomy — new connection types and wire types

Do this before the extractor so the extractor's output can be asserted against
a real taxonomy rather than a promise.

**Files:**
- Modify: `src/lib/catalog-connect.ts`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `PASSTHROUGH_TYPES` from Task 2
- Produces: an enlarged `CONNECTION_TYPES` and `DEFAULT_WIRE_TYPES`

- [ ] **Step 1: Write the failing tests**

Import:

```ts
import { CONNECTION_TYPES, DEFAULT_WIRE_TYPES, canConnect, compatibleWireTypes } from "@/lib/catalog-connect";
```

Append:

```ts
/* ====== #162 taxonomy ====== */
ok(CONNECTION_TYPES.includes("line power (unspecified)"), "#162 the unspecified-power type exists");
ok(
  PASSTHROUGH_TYPES.every((t) => CONNECTION_TYPES.includes(t)),
  "#162 every pass-through type the protocol map can emit is a declared connection type"
);
// No orphans: anything the map emits must be carried by some wire type, or the
// Grid can validate the wire but offer no cable for it.
const emitted162 = [...new Set(Object.values(PROTOCOL_MAP).flatMap((m) =>
  m.kind === "peak" || m.kind === "passthrough" ? [m.connectionType] : []
).concat(["powerCON/True1", "bare-end", "line power (unspecified)"]))];
const orphans162 = emitted162.filter((t) => compatibleWireTypes(t, DEFAULT_WIRE_TYPES).length === 0);
ok(orphans162.length === 0, `#162 no connection type is left without a wire type (orphans: ${orphans162.join(", ")})`);

// D1 — pass-through mates with itself and nothing else.
const p162 = (connectionType: string, direction: "in" | "out" | "io") => ({ name: "", direction, connectionType });
ok(
  canConnect(p162("ETC EchoConnect", "out"), p162("ETC EchoConnect", "in")),
  "#162 an EchoConnect output reaches an EchoConnect input"
);
ok(
  !canConnect(p162("ETC EchoConnect", "out"), p162("contact closure", "in")),
  "#162 EchoConnect does NOT reach a contact closure — the collapse this design refuses"
);
ok(
  !canConnect(p162("ETC ArcSystem D4 driver", "out"), p162("ETC ArcSystem D2 driver", "in")),
  "#162 two different ArcSystem driver families never cross-connect"
);
ok(
  canConnect(p162("ETC ArcSystem D4 driver", "out"), p162("ETC ArcSystem D4 driver", "in")),
  "#162 one ArcSystem driver family connects to itself"
);
// D4 — unspecified power reaches unspecified power (fixture ↔ dimmer) but is
// not silently equated with a specific connector.
ok(
  canConnect(p162("line power (unspecified)", "in"), p162("line power (unspecified)", "out")),
  "#162 a Source Four's unspecified power inlet reaches a dimmer's unspecified outlet"
);
ok(
  !canConnect(p162("line power (unspecified)", "in"), p162("Edison", "out")),
  "#162 unspecified power is not silently treated as Edison"
);
// speaker-pair stays the ONLY interchangeable family.
ok(
  DEFAULT_WIRE_TYPES.filter((w) => w.interchangeable).map((w) => w.id).join(",") === "speaker-pair",
  "#162 no ETC wire type is marked interchangeable — speaker-pair remains the only one"
);
```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH="$HOME/.local/node/bin:$PATH" && npm run test:specs 2>&1 | tail -20
```

Expected: failures on the new types not existing.

- [ ] **Step 3: Write the implementation**

In `src/lib/catalog-connect.ts`, append to `CONNECTION_TYPES` before the closing `]`:

```ts
  // power, continued (#162 D4) — DaVinci records 1,417 power ports whose
  // connector is the generic "Power", meaning "needs line power, connector
  // unspecified". Peak's other power types are all specific and deliberately
  // not interchangeable, so calling a Source Four's pigtail "bare-end" would
  // be a lie on the label. This type connects to itself and claims nothing.
  "line power (unspecified)",
  // ETC (DaVinci import, #162 D1) — carried verbatim from ETC's library rather
  // than collapsed into the nearest Peak type. canConnect is exact string
  // equality, so each mates only with itself: correct, with no false positives.
  // Collapsing them would let the Grid validate an Echoflex sensor against a
  // DMX terminal block. 508 ETC parts (19.3% of those with ports) would import
  // unwireable without these.
  "ETC 0-10V dimming",
  "ETC 208V feeder",
  "ETC 480V feeder",
  "ETC ArcSystem D1HO driver",
  "ETC ArcSystem D2 driver",
  "ETC ArcSystem D4 driver",
  "ETC auxiliary power",
  "ETC BluesSystem low voltage",
  "ETC CANbus",
  "ETC Control/SafetyLink (MCX)",
  "ETC DALI",
  "ETC EchoConnect",
  "ETC EchoConnect (line voltage)",
  "ETC Echoflex (wireless)",
  "ETC F-Drive ARC",
  "ETC F-Drive CC",
  "ETC F-Drive CV",
  "ETC F-Drive Chroma",
  "ETC F-Drive FTW",
  "ETC F-Drive R12 power supply",
  "ETC F-Drive RX CC",
  "ETC F-Drive RX CV",
  "ETC F-Drive RX FTW",
  "ETC F-Drive RX power supply",
  "ETC LSH control",
  "ETC LinkConnect",
  "ETC LinkConnect (Paradigm portable)",
  "ETC LinkConnect (SPS)",
  "ETC MIDI",
  "ETC MeshConnect (wireless)",
  "ETC Multiverse (wireless DMX)",
  "ETC SMPTE timecode",
  "ETC Sense",
  "ETC USB",
  "ETC control (generic)",
  "ETC serial",
```

Add `"line power (unspecified)"` to the existing `powercon-power` wire type's
`connectionTypes` array, then append these wire types to `DEFAULT_WIRE_TYPES`:

```ts
  // ETC families (#162). None is `interchangeable`: speaker-pair remains the
  // only family where mismatched connectors mate, for the reasons on that flag.
  // Several of these are wireless (Echoflex, Multiverse, MeshConnect) and have
  // no cable at all — they get a wire type anyway so the Grid has something to
  // name the link, and their dollarsPerFt stays unset.
  { id: "etc-echoconnect", label: "ETC EchoConnect", connectionTypes: ["ETC EchoConnect", "ETC EchoConnect (line voltage)"] },
  { id: "etc-linkconnect", label: "ETC LinkConnect", connectionTypes: ["ETC LinkConnect", "ETC LinkConnect (Paradigm portable)", "ETC LinkConnect (SPS)"] },
  {
    id: "etc-fdrive",
    label: "ETC F-Drive",
    connectionTypes: [
      "ETC F-Drive ARC", "ETC F-Drive CC", "ETC F-Drive CV", "ETC F-Drive Chroma",
      "ETC F-Drive FTW", "ETC F-Drive R12 power supply", "ETC F-Drive RX CC",
      "ETC F-Drive RX CV", "ETC F-Drive RX FTW", "ETC F-Drive RX power supply",
    ],
  },
  { id: "etc-arcsystem", label: "ETC ArcSystem driver", connectionTypes: ["ETC ArcSystem D1HO driver", "ETC ArcSystem D2 driver", "ETC ArcSystem D4 driver"] },
  // 208V and 480V share a wire type but NOT an identity — a wire type answers
  // "what cable runs this", never "what mates with what" (cat6 already carries
  // Dante, sACN and HDBaseT, none of which mate).
  { id: "etc-feeder", label: "ETC feeder (208V/480V)", connectionTypes: ["ETC 208V feeder", "ETC 480V feeder"] },
  { id: "etc-aux-power", label: "ETC auxiliary power", connectionTypes: ["ETC auxiliary power"] },
  { id: "etc-dali", label: "DALI", connectionTypes: ["ETC DALI"] },
  { id: "etc-0-10v", label: "0-10V dimming", connectionTypes: ["ETC 0-10V dimming"] },
  { id: "etc-usb", label: "USB", connectionTypes: ["ETC USB"] },
  { id: "etc-midi", label: "MIDI", connectionTypes: ["ETC MIDI"] },
  { id: "etc-serial", label: "Serial / SMPTE", connectionTypes: ["ETC serial", "ETC SMPTE timecode"] },
  { id: "etc-control", label: "ETC control", connectionTypes: ["ETC Control/SafetyLink (MCX)", "ETC LSH control", "ETC Sense", "ETC CANbus", "ETC BluesSystem low voltage", "ETC control (generic)"] },
  { id: "etc-wireless", label: "ETC wireless (no cable)", connectionTypes: ["ETC Echoflex (wireless)", "ETC Multiverse (wireless DMX)", "ETC MeshConnect (wireless)"] },
```

**Note on grouping:** a wire type may carry several connection types without
making them interchangeable — `cat6` already carries Dante, sACN and HDBaseT,
and those do not mate. Grouping only answers "what cable runs this".

- [ ] **Step 4: Run tests to verify they pass**

```bash
export PATH="$HOME/.local/node/bin:$PATH" && npm run test:specs 2>&1 | tail -5
```

Expected: `0 FAIL`, and the orphan assertion names nothing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog-connect.ts scripts/test-review-and-spec.ts
git commit -m "feat(catalog): ETC connection + wire types, none interchangeable (#162, D1/D4)"
```

---

### Task 4: Types and the extractor

**Files:**
- Create: `src/lib/davinci/types.ts`, `src/lib/davinci/extract.ts`
- Create: `scripts/davinci-extract.ts`
- Modify: `package.json` (add `davinci:extract`)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `normalizeSku` (Task 1), `mapProtocol`/`DIRECTION_MAP` (Task 2), `Port` from `@/lib/catalog-connect`
- Produces:
  - `type DavinciDoc = { kind: "datasheet" | "manual"; label: string; url: string }`
  - `type DavinciRecord = { typeId; displayName; category; modelNumbers: string[]; ports: Port[]; docs: DavinciDoc[] }`
  - `type DavinciExtract = { libraryTimestamp: string; generatedAt: number; records: DavinciRecord[] }`
  - `extractLibrary(lib: unknown): DavinciExtract`

- [ ] **Step 1: Write the failing tests**

These run against a small hand-built fixture so they do not need the 116 MB file.

```ts
import { extractLibrary } from "@/lib/davinci/extract";
```

```ts
/* ====== #162 extractor ====== */
const LIB162 = {
  timestamp: "2026-09-02T01:37:52.850Z",
  constants: {
    languages: [{ languageId: "L-EN", text: "English" }, { languageId: "L-FR", text: "Francais" }],
    documentTypes: [{ documentTypeId: "T-DS", text: "Datasheet" }, { documentTypeId: "T-MN", text: "Manual" }, { documentTypeId: "T-BR", text: "Brochure" }],
    categories: [{ categoryId: "C-1", text: "ColorSource" }, { categoryId: "C-X", text: "Internal-DO NOT USE" }],
    portDirections: [{ portDirectionId: "D-IN", text: "Input" }, { portDirectionId: "D-OUT", text: "Output" }, { portDirectionId: "D-BUS", text: "Bus" }],
    connectorTypes: [{ connectorTypeId: "K-PC", text: "powerCON In" }, { connectorTypeId: "K-DMX", text: "DMX Male" }, { connectorTypeId: "K-GEN", text: "Power" }],
    portProtocols: [],
  },
  documents: { documents: [
    { documentId: "DOC-1", url: "https://example.test/ds-en.pdf", metadata: { name: "CSPAR Datasheet", type: "T-DS", language: "L-EN" } },
    { documentId: "DOC-2", url: "https://example.test/ds-fr.pdf", metadata: { name: "CSPAR Datasheet FR", type: "T-DS", language: "L-FR" } },
    { documentId: "DOC-3", url: "https://example.test/br-en.pdf", metadata: { name: "CSPAR Brochure", type: "T-BR", language: "L-EN" } },
  ] },
  types: [
    {
      typeId: "TY-1",
      typeInformation: { displayName: "ColorSource PAR", categoryId: "C-1" },
      partInformation: { generatorData: { lookupData: [
        { modelNumber: "CSPAR", partNumber: "7410A1001" },
        { modelNumber: "CSPAR-X", partNumber: "7410A1002" },
      ] } },
      documents: ["DOC-1", "DOC-2", "DOC-3"],
      ports: [
        { name: "", portProtocolId: "aa07559e-6609-4ec6-8df3-8990d6bc9909", connectorTypeId: "K-PC", portDirectionId: "D-IN" },
        { name: "", portProtocolId: "698f9701-604c-4432-902f-19866c061108", connectorTypeId: "K-DMX", portDirectionId: "D-IN" },
        { name: "", portProtocolId: "aa07559e-6609-4ec6-8df3-8990d6bc9909", connectorTypeId: "K-GEN", portDirectionId: "D-BUS" },
      ],
    },
    // Excluded: internal category.
    { typeId: "TY-X", typeInformation: { displayName: "RouteStubPrototype", categoryId: "C-X" },
      partInformation: { generatorData: { lookupData: [{ modelNumber: "STUB", partNumber: "X" }] } },
      documents: [], ports: [{ name: "", portProtocolId: "698f9701-604c-4432-902f-19866c061108", connectorTypeId: "K-DMX", portDirectionId: "D-IN" }] },
    // No ports and no docs: nothing to contribute, must not appear.
    { typeId: "TY-0", typeInformation: { displayName: "Empty", categoryId: "C-1" },
      partInformation: { generatorData: { lookupData: [{ modelNumber: "EMPTY", partNumber: "E" }] } }, documents: [], ports: [] },
  ],
};
const ex162 = extractLibrary(LIB162);
ok(ex162.libraryTimestamp === "2026-09-02T01:37:52.850Z", "#162 the extract stamps the library's own timestamp");
ok(ex162.records.length === 1, "#162 internal-category and contentless types are dropped from the extract");
const r162 = ex162.records[0];
ok(r162.modelNumbers.includes("CSPAR") && r162.modelNumbers.includes("7410A1001"), "#162 both model and part numbers are indexed");
ok(r162.modelNumbers.length === 4, "#162 all four identifiers of a two-variant type are indexed");
ok(r162.modelNumbers.every((m) => m === m.toUpperCase()), "#162 indexed identifiers are pre-normalized");
ok(r162.docs.length === 1 && r162.docs[0].kind === "datasheet", "#162 only the English Datasheet/Manual documents survive");
ok(r162.docs[0].url === "https://example.test/ds-en.pdf", "#162 the document URL is carried verbatim");
ok(r162.ports.length === 3, "#162 every port of a kept type is emitted");
ok(r162.ports[0].connectionType === "powerCON/True1" && r162.ports[0].direction === "in", "#162 a powerCON input maps through");
ok(r162.ports[1].connectionType === "DMX512 (5-pin XLR)", "#162 a DMX port maps through");
ok(r162.ports[2].connectionType === "line power (unspecified)" && r162.ports[2].direction === "io", "#162 a generic-connector Bus power port becomes unspecified/io");
ok(r162.ports.every((p) => typeof p.name === "string"), "#162 every emitted port has a string name, never undefined");
```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH="$HOME/.local/node/bin:$PATH" && npm run test:specs 2>&1 | tail -20
```

- [ ] **Step 3: Write the implementation**

`src/lib/davinci/types.ts`:

```ts
import type { Port } from "@/lib/catalog-connect";

export type DavinciDoc = {
  kind: "datasheet" | "manual";
  label: string;
  /** The manufacturer's own public URL. Never fetched server-side, never proxied. */
  url: string;
};

export type DavinciRecord = {
  typeId: string;
  displayName: string;
  category: string;
  /** Every model AND part number of this type, already through normalizeSku. */
  modelNumbers: string[];
  ports: Port[];
  docs: DavinciDoc[];
};

export type DavinciExtract = {
  libraryTimestamp: string;
  generatedAt: number;
  records: DavinciRecord[];
};
```

`src/lib/davinci/extract.ts`:

```ts
/**
 * DaVinci `library.json` → the committed extract (#162, D8).
 *
 * The full library is 116 MB, gitignored, and exists on one machine. This
 * distils it to the 0.52 MB `data/davinci-extract.json` that ships in the repo:
 * 908 device types, 7,083 indexed identifiers, 2,335 ports and 1,173 document
 * links. Ports are mapped here, once, so the extract is directly reviewable and
 * the enricher never has to reason about DaVinci's UUIDs.
 *
 * Deliberately tolerant of shape but NOT of unknown protocols: mapProtocol
 * throws, and that is the point (D2).
 */
import type { Port } from "@/lib/catalog-connect";
import { normalizeSku } from "./sku";
import { DIRECTION_MAP, mapProtocol } from "./protocol-map";
import type { DavinciDoc, DavinciExtract, DavinciRecord } from "./types";

/** ETC's internal scratch category — never a product (D5). */
const EXCLUDED_CATEGORIES = new Set(["Internal-DO NOT USE"]);
const KEPT_DOC_TYPES: Record<string, DavinciDoc["kind"]> = { Datasheet: "datasheet", Manual: "manual" };

type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag => (v && typeof v === "object" ? (v as Bag) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Constants are lists of `{ <thing>Id, constantName?, text? }`. */
function labelIndex(list: unknown, idKey: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of arr(list)) {
    const x = bag(raw);
    const id = str(x[idKey]);
    if (id) out.set(id, str(x.text) || str(x.constantName));
  }
  return out;
}

export function extractLibrary(lib: unknown): DavinciExtract {
  const L = bag(lib);
  const C = bag(L.constants);
  const langs = labelIndex(C.languages, "languageId");
  const docTypes = labelIndex(C.documentTypes, "documentTypeId");
  const cats = labelIndex(C.categories, "categoryId");
  const dirs = labelIndex(C.portDirections, "portDirectionId");
  const conns = labelIndex(C.connectorTypes, "connectorTypeId");

  const docs = new Map<string, Bag>();
  for (const raw of arr(bag(L.documents).documents)) {
    const x = bag(raw);
    const id = str(x.documentId);
    if (id) docs.set(id, x);
  }

  const records: DavinciRecord[] = [];
  for (const raw of arr(L.types)) {
    const t = bag(raw);
    const ti = bag(t.typeInformation);
    const category = cats.get(str(ti.categoryId)) || "";
    if (EXCLUDED_CATEGORIES.has(category)) continue;

    const ports: Port[] = [];
    for (const rawPort of arr(t.ports)) {
      const p = bag(rawPort);
      const connector = conns.get(str(p.connectorTypeId)) || "";
      const resolved = mapProtocol(str(p.portProtocolId), connector);
      if ("excluded" in resolved) continue;
      const direction = DIRECTION_MAP[dirs.get(str(p.portDirectionId)) || ""];
      if (!direction) continue;
      ports.push({
        // DaVinci leaves most port names blank; the connector is the most
        // useful thing a human can be shown in its place.
        name: str(p.name) || connector,
        direction,
        connectionType: resolved.connectionType,
      });
    }

    const out: DavinciDoc[] = [];
    for (const id of arr(t.documents)) {
      const d = docs.get(str(id));
      if (!d) continue;
      const m = bag(d.metadata);
      if (langs.get(str(m.language)) !== "English") continue;
      const kind = KEPT_DOC_TYPES[docTypes.get(str(m.type)) || ""];
      if (!kind) continue;
      out.push({ kind, label: str(m.name), url: str(d.url) });
    }

    // A type with neither ports nor documents has nothing to give a catalog row.
    if (!ports.length && !out.length) continue;

    const ids = new Set<string>();
    for (const rawLut of arr(bag(bag(t.partInformation).generatorData).lookupData)) {
      const l = bag(rawLut);
      for (const k of ["modelNumber", "partNumber"] as const) {
        const v = normalizeSku(str(l[k]));
        if (v) ids.add(v);
      }
    }
    if (!ids.size) continue;

    records.push({
      typeId: str(t.typeId),
      displayName: str(ti.displayName),
      category,
      modelNumbers: [...ids],
      ports,
      docs: out,
    });
  }

  return { libraryTimestamp: str(L.timestamp), generatedAt: Date.now(), records };
}
```

`scripts/davinci-extract.ts`:

```ts
/**
 * Regenerate `data/davinci-extract.json` from the full DaVinci library (#162, D8).
 *
 *   npm run davinci:extract
 *
 * Reads `data/davinci/source/<newest timestamp>/library.json` (116 MB,
 * gitignored, this machine only) and writes the ~0.5 MB extract that IS
 * committed. Touches no database. Re-run when ETC ships a new export; if it has
 * added a port protocol, the extract will throw with the new UUID rather than
 * mis-typing its ports.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { extractLibrary } from "../src/lib/davinci/extract";

const SRC = "data/davinci/source";
const OUT = "data/davinci-extract.json";

function main() {
  if (!existsSync(SRC)) {
    console.error(
      `No ${SRC}. The 116 MB DaVinci library is gitignored and lives on Jeff's machine only.\n` +
        `The committed ${OUT} is what the enricher reads — you only need this script to refresh it.`
    );
    process.exit(1);
  }
  const dir = readdirSync(SRC).sort().reverse()[0];
  const file = join(SRC, dir, "library.json");
  console.log(`[davinci] reading ${file}`);
  const extract = extractLibrary(JSON.parse(readFileSync(file, "utf8")));
  writeFileSync(OUT, JSON.stringify(extract));
  const bytes = Buffer.byteLength(JSON.stringify(extract));
  console.log(
    `[davinci] ${extract.records.length} records · ` +
      `${extract.records.reduce((a, r) => a + r.modelNumbers.length, 0)} identifiers · ` +
      `${extract.records.reduce((a, r) => a + r.ports.length, 0)} ports · ` +
      `${extract.records.reduce((a, r) => a + r.docs.length, 0)} docs · ` +
      `${(bytes / 1048576).toFixed(2)} MB → ${OUT}`
  );
}
main();
```

In `package.json` `scripts`, after `"db:export"`:

```json
    "davinci:extract": "tsx scripts/davinci-extract.ts",
```

- [ ] **Step 4: Run tests, then generate the real extract**

```bash
export PATH="$HOME/.local/node/bin:$PATH" && npm run test:specs 2>&1 | tail -5
```

Expected: `0 FAIL`.

```bash
export PATH="$HOME/.local/node/bin:$PATH" && npm run davinci:extract
```

Expected, measured against the real library on 2026-09-23:

```
[davinci] 1720 records · 14108 identifiers · 6241 ports · 2836 docs · ~1.35 MB → data/davinci-extract.json
```

The four counts are exact — they were measured against the real library. The
**size is approximate**: the measurement used a fixed-width placeholder for
`connectionType`, and the real labels vary in length, so anything in the
1.2–1.6 MB range is correct. Treat a deviation in the *counts* as a bug in
Task 2 or Task 4, not as drift. The
extract covers every eligible type, not only the 908 that match today's
catalog, which is why it is larger than the 0.52 MB measured for matches alone.
If it throws on an unmapped protocol UUID, Task 2's map is incomplete — add the
protocol to the map after deciding what it is; never widen the throw.

- [ ] **Step 5: Commit**

```bash
git add src/lib/davinci/types.ts src/lib/davinci/extract.ts scripts/davinci-extract.ts package.json data/davinci-extract.json scripts/test-review-and-spec.ts
git commit -m "feat(davinci): extract the library to a committed 0.5MB artifact (#162, D8)"
```

---

### Task 5: The matcher

**Files:**
- Create: `src/lib/davinci/match.ts` — pure, no I/O
- Create: `src/lib/davinci/load.ts` — the only file here that touches the filesystem
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `normalizeSku`, `DavinciRecord`, `DavinciExtract`
- Produces:
  - `match.ts`: `buildIndex(records: readonly DavinciRecord[]): Map<string, DavinciRecord>`
  - `match.ts`: `matchSku(sku: string, index: Map<string, DavinciRecord>): DavinciRecord | null`
  - `load.ts`: `loadExtract(file?: string): DavinciExtract` — memoized

**Why two files:** `loadExtract` needs `node:fs`. Keeping it out of `match.ts`
means `match.ts` stays pure and safe to import from anywhere, including a
client component — `node:fs` reached through a client import chain is a build
error, and the split costs nothing.

- [ ] **Step 1: Write the failing tests**

```ts
import { buildIndex, matchSku } from "@/lib/davinci/match";
```

```ts
/* ====== #162 matcher ====== */
const IDX162 = buildIndex(ex162.records);
ok(matchSku("CSPAR", IDX162)?.typeId === "TY-1", "#162 a bare production SKU matches");
ok(matchSku("ETC:CSPAR", IDX162)?.typeId === "TY-1", "#162 a prefixed dev SKU matches the same record");
ok(matchSku("7410A1001", IDX162)?.typeId === "TY-1", "#162 a part number matches as well as a model number");
ok(matchSku("cspar", IDX162)?.typeId === "TY-1", "#162 matching is case-insensitive");
ok(matchSku("NOT-A-PART", IDX162) === null, "#162 an unknown SKU returns null, never a near miss");
ok(matchSku("", IDX162) === null, "#162 an empty SKU never matches");
ok(matchSku("   ", IDX162) === null, "#162 a whitespace SKU never matches");
// First record wins on a collision, deterministically — never a random one.
const dupe162 = buildIndex([
  { typeId: "A", displayName: "A", category: "c", modelNumbers: ["SHARED"], ports: [], docs: [] },
  { typeId: "B", displayName: "B", category: "c", modelNumbers: ["SHARED"], ports: [], docs: [] },
]);
ok(matchSku("SHARED", dupe162)?.typeId === "A", "#162 a duplicated identifier resolves to the first record, deterministically");
```

- [ ] **Step 2: Run to verify it fails**

```bash
export PATH="$HOME/.local/node/bin:$PATH" && npm run test:specs 2>&1 | tail -20
```

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Match a catalog SKU to a DaVinci record (#162).
 *
 * Both sides go through `normalizeSku`, which is why it lives in its own module:
 * production writes bare model numbers, local dev writes `MFR:`-prefixed ones,
 * and DaVinci writes bare model AND part numbers. Measured 2026-09-23 against
 * production: 2,917 of 3,959 ETC rows (73.7%) match.
 */
import { normalizeSku } from "./sku";
import type { DavinciRecord } from "./types";

export function buildIndex(records: readonly DavinciRecord[]): Map<string, DavinciRecord> {
  const idx = new Map<string, DavinciRecord>();
  for (const r of records) {
    for (const m of r.modelNumbers) {
      // First record wins. ETC reuses an identifier across a type and its
      // accessory in a handful of cases; picking the first keeps the result
      // reproducible instead of depending on iteration order downstream.
      if (!idx.has(m)) idx.set(m, r);
    }
  }
  return idx;
}

export function matchSku(sku: string, index: Map<string, DavinciRecord>): DavinciRecord | null {
  const key = normalizeSku(sku);
  if (!key) return null;
  return index.get(key) ?? null;
}

```

`src/lib/davinci/load.ts`:

```ts
/**
 * Read the committed DaVinci extract (#162, D8).
 *
 * Separate from `match.ts` purely so that `match.ts` stays free of `node:fs`
 * and is therefore safe to import from a client component. This module is
 * server/script only.
 */
import { readFileSync } from "node:fs";
import type { DavinciExtract } from "./types";

let cached: DavinciExtract | null = null;

/** Memoized — callers walk 37k catalog rows against the same extract. */
export function loadExtract(file = "data/davinci-extract.json"): DavinciExtract {
  if (!cached) cached = JSON.parse(readFileSync(file, "utf8")) as DavinciExtract;
  return cached;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
export PATH="$HOME/.local/node/bin:$PATH" && npm run test:specs 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/davinci/match.ts src/lib/davinci/load.ts scripts/test-review-and-spec.ts
git commit -m "feat(davinci): SKU matcher over the committed extract (#162)"
```

---

### Task 6: The writer

**Files:**
- Create: `src/lib/catalog-davinci-apply.ts`
- Modify: `src/lib/stores/catalog.ts` (add `docs?`, `davinci?` to `CatalogPart`)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `loadExtract` (from `@/lib/davinci/load`), `buildIndex`/`matchSku` (from `@/lib/davinci/match`), catalog store `list`/`mergeUpsert`
- Produces:
  - `type EnrichPlan = { sku: string; displayName: string; ports: Port[]; docs: DavinciDoc[]; typeId: string; skip?: "has-ports" | "nothing-to-write" }`
  - `planEnrichment(opts: { mfr?: string; onlySkus?: string[]; force?: boolean }): Promise<{ plans: EnrichPlan[]; stats: EnrichStats }>`
  - `applyEnrichment(plans: EnrichPlan[], opts: { commit: boolean }): Promise<{ written: number }>`

**The scope rule that #159's D202 exists to teach:** `applyRules` walked every
row of `catalog_parts` by default, so a test that created four fixtures wrote
452 real rows. `applyEnrichment` therefore writes **only the plans handed to
it**, and never queries for more.

- [ ] **Step 1: Add the `CatalogPart` fields**

In `src/lib/stores/catalog.ts`, after `datasheetName`:

```ts
  /** Manufacturer document links (#162). Distinct from `datasheetBlobKey`,
   *  which is a Peak-uploaded PDF in Blob storage: these are the
   *  manufacturer's own public URLs carried from ETC's DaVinci library. They
   *  are rendered as outbound links and are never fetched server-side or
   *  proxied — treat them as third-party content. */
  docs?: { kind: "datasheet" | "manual"; label: string; url: string }[];
  /** Provenance for anything the DaVinci enricher wrote (#162) — which library
   *  export and which ETC type a row's ports and docs came from, so a later run
   *  can tell its own writes from a human's edit in the #158 ports editor. */
  davinci?: { typeId: string; libraryTimestamp: string; enrichedAt: number };
```

- [ ] **Step 2: Write the failing tests**

```ts
import { planEnrichment, applyEnrichment } from "@/lib/catalog-davinci-apply";
import { upsert as upsertPart, get as getPart } from "@/lib/stores/catalog";
```

```ts
/* ====== #162 the writer (scratch datadir only) ====== */
{
  const SKU_A = "TEST162:CSPAR";       // will match DaVinci's CSPAR
  const SKU_B = "TEST162:HAS-PORTS";
  const SKU_C = "TEST162:NO-MATCH-AT-ALL-XYZ";
  await upsertPart({ id: SKU_A, sku: SKU_A, desc: "t", category: "Fixtures", unit: "ea", list: 1040, cost: 624, mfr: "TEST162" });
  await upsertPart({ id: SKU_B, sku: SKU_B, desc: "t", category: "Fixtures", unit: "ea", list: 10, cost: 6, mfr: "TEST162",
    ports: [{ name: "hand-made", direction: "in", connectionType: "Edison" }] });
  await upsertPart({ id: SKU_C, sku: SKU_C, desc: "t", category: "Fixtures", unit: "ea", list: 5, cost: 3, mfr: "TEST162" });

  try {
    const planned = await planEnrichment({ mfr: "TEST162" });
    const bySku = (s: string) => planned.plans.find((p) => p.sku === s);
    ok(bySku(SKU_B)?.skip === "has-ports", "#162 a part with hand-edited ports is skipped, not overwritten");
    ok(!bySku(SKU_C), "#162 a part with no DaVinci entry produces no plan at all");
    ok((bySku(SKU_A)?.ports.length ?? 0) > 0, "#162 a matching part is planned with ports");

    // Dry run writes nothing.
    await applyEnrichment(planned.plans, { commit: false });
    ok(!(await getPart(SKU_A))?.ports?.length, "#162 a dry run writes nothing at all");

    const before = await getPart(SKU_A);
    const res = await applyEnrichment(planned.plans, { commit: true });
    const after = await getPart(SKU_A);
    ok(res.written === 1, "#162 exactly the planned rows are written");
    ok((after?.ports?.length ?? 0) > 0, "#162 a commit writes the ports");
    ok(after?.davinci?.typeId != null, "#162 a commit stamps provenance");
    ok(after?.list === before?.list && after?.cost === before?.cost, "#162 list and cost are byte-identical after a commit");
    ok(after?.pricedAt === before?.pricedAt, "#162 pricedAt is never moved by enrichment");

    // The hand-made ports on B survived.
    ok((await getPart(SKU_B))?.ports?.[0]?.connectionType === "Edison", "#162 the hand-edited part is untouched by a commit");

    // Scope: applyEnrichment writes ONLY what it was handed (D202's lesson).
    const empty = await applyEnrichment([], { commit: true });
    ok(empty.written === 0, "#162 an empty plan list writes nothing — apply never queries for more rows");
  } finally {
    for (const s of [SKU_A, SKU_B, SKU_C]) await softDeleteDoc("catalog_parts", s);
  }
}
```

- [ ] **Step 3: Run to verify it fails**

```bash
export PATH="$HOME/.local/node/bin:$PATH" && npm run test:specs 2>&1 | tail -20
```

- [ ] **Step 4: Write the implementation**

```ts
/**
 * Write DaVinci ports and document links onto catalog rows Peak already owns
 * (#162). The ONLY module in this feature that writes.
 *
 * Plan and apply are separate so the CLI's report describes exactly the rows a
 * commit would touch — "the report does not describe the run" is the defect
 * `scripts/db-target.ts` was written to prevent, and #159's D202 is what
 * happens when a writer discovers its own scope: `applyRules` walked every row
 * of `catalog_parts`, so a test with four fixtures wrote 452 real parts.
 * `applyEnrichment` writes only the plans handed to it and never queries.
 *
 * Never creates a row, never deletes one, and never writes list/cost/pricedAt.
 */
import type { Port } from "@/lib/catalog-connect";
import { list as allParts, mergeUpsert, type CatalogPart } from "@/lib/stores/catalog";
import { buildIndex, matchSku } from "@/lib/davinci/match";
import { loadExtract } from "@/lib/davinci/load";
import type { DavinciDoc } from "@/lib/davinci/types";

export type EnrichPlan = {
  sku: string;
  displayName: string;
  typeId: string;
  ports: Port[];
  docs: DavinciDoc[];
  skip?: "has-ports" | "nothing-to-write";
};

export type EnrichStats = {
  scanned: number;
  matched: number;
  writable: number;
  skippedHasPorts: number;
  unmatched: string[];
};

export async function planEnrichment(opts: {
  mfr?: string;
  onlySkus?: string[];
  force?: boolean;
} = {}): Promise<{ plans: EnrichPlan[]; stats: EnrichStats }> {
  const extract = loadExtract();
  const index = buildIndex(extract.records);
  const only = opts.onlySkus?.length ? new Set(opts.onlySkus) : null;

  const parts = (await allParts()).filter(
    (p) => (!opts.mfr || p.mfr === opts.mfr) && (!only || only.has(p.sku))
  );

  const plans: EnrichPlan[] = [];
  const stats: EnrichStats = { scanned: parts.length, matched: 0, writable: 0, skippedHasPorts: 0, unmatched: [] };

  for (const p of parts) {
    const rec = matchSku(p.sku, index);
    if (!rec) {
      stats.unmatched.push(p.sku);
      continue;
    }
    stats.matched++;
    const plan: EnrichPlan = {
      sku: p.sku,
      displayName: rec.displayName,
      typeId: rec.typeId,
      ports: rec.ports,
      docs: rec.docs,
    };
    // A human's edit in the #158 ports editor outranks the library (D6).
    if (p.ports?.length && !opts.force) {
      plan.skip = "has-ports";
      stats.skippedHasPorts++;
    } else if (!rec.ports.length && !rec.docs.length) {
      plan.skip = "nothing-to-write";
    } else {
      stats.writable++;
    }
    plans.push(plan);
  }
  return { plans, stats };
}

export async function applyEnrichment(
  plans: readonly EnrichPlan[],
  opts: { commit: boolean }
): Promise<{ written: number }> {
  if (!opts.commit) return { written: 0 };
  const extract = loadExtract();
  let written = 0;
  for (const plan of plans) {
    if (plan.skip) continue;
    // mergeUpsert is `{ ...existing, ...patch }` — a key absent from the patch
    // leaves the stored value, so naming only these four keys is what keeps
    // list, cost and pricedAt untouched.
    const patch: Partial<Omit<CatalogPart, "id" | "sku">> = {
      davinci: {
        typeId: plan.typeId,
        libraryTimestamp: extract.libraryTimestamp,
        enrichedAt: Date.now(),
      },
    };
    if (plan.ports.length) patch.ports = plan.ports;
    if (plan.docs.length) patch.docs = plan.docs;
    // mergeUpsert(sku, patch) — the SKU is positional, NOT a key in the patch
    // (its type is Omit<CatalogPart, "id" | "sku">). Naming only these three
    // keys is what keeps list, cost and pricedAt untouched: writePart stamps
    // pricedAt via nextPricedAt only when list or cost actually change, and
    // the merged part carries the stored values for both. `updatedAt` DOES
    // move — every write stamps it, and that is correct.
    await mergeUpsert(plan.sku, patch);
    written++;
  }
  return { written };
}
```

**Already verified against `src/lib/stores/catalog.ts` (2026-09-23):**
`mergeUpsert(sku: string, patch: Partial<Omit<CatalogPart, "id" | "sku">>, opts?: UpsertOpts)`,
and `writePart` computes `pricedAt` through `nextPricedAt(existing, part, …)`,
which stamps only when `list` or `cost` change. Omitting both from the patch
therefore preserves `pricedAt`. Do not re-derive this — but do re-read the file
if the signature has moved since.

- [ ] **Step 5: Run tests to verify they pass**

```bash
export PATH="$HOME/.local/node/bin:$PATH" && npm run test:specs 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add src/lib/catalog-davinci-apply.ts src/lib/stores/catalog.ts scripts/test-review-and-spec.ts
git commit -m "feat(catalog): the DaVinci enrichment writer, scoped and price-safe (#162, D6/D7)"
```

---

### Task 7: The CLI

**Files:**
- Create: `scripts/davinci-enrich.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `planEnrichment`, `applyEnrichment`, `resolveDbTarget`, `requireHostedConfirmation`
- Produces: `npm run davinci:enrich`

- [ ] **Step 1: Write the implementation**

```ts
/**
 * DaVinci → catalog enrichment: report, dry run, apply (#162).
 *
 *   npm run davinci:enrich                          → the report, writes nothing
 *   npm run davinci:enrich -- --mfr=ETC              → scope to one manufacturer
 *   npm run davinci:enrich -- --unmatched            → CSV of what did not match
 *   npm run davinci:enrich -- --apply                → dry run, writes nothing
 *   npm run davinci:enrich -- --apply --commit       → write (hosted also needs --yes)
 *
 * DRY RUN IS THE DEFAULT. `--commit` says "I want to write"; `--yes` says "I
 * know this is the live database". They are separate because preview and
 * production share one Neon database — see scripts/db-target.ts.
 */
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";
import { planEnrichment, applyEnrichment } from "../src/lib/catalog-davinci-apply";

const args = process.argv.slice(2);
const mfr = (args.find((a) => a.startsWith("--mfr=")) || "").slice(6) || undefined;
const commit = args.includes("--commit");
const force = args.includes("--force");
const n = (x: number) => x.toLocaleString("en-US");

async function main() {
  const { hosted } = resolveDbTarget(commit ? "davinci:enrich (WRITE)" : "davinci:enrich (read-only)");
  if (commit) requireHostedConfirmation(hosted, args);

  const { plans, stats } = await planEnrichment({ mfr, force });

  if (args.includes("--unmatched")) {
    console.log("sku");
    for (const s of stats.unmatched) console.log(s);
    return;
  }

  console.log(`\n  scanned            ${n(stats.scanned)}${mfr ? ` (mfr=${mfr})` : ""}`);
  console.log(`  matched DaVinci    ${n(stats.matched)}`);
  console.log(`  writable           ${n(stats.writable)}`);
  console.log(`  skipped, has ports ${n(stats.skippedHasPorts)}${force ? " (overridden by --force)" : ""}`);
  console.log(`  unmatched          ${n(stats.unmatched.length)}   (--unmatched for the list)\n`);

  const sample = plans.filter((p) => !p.skip).slice(0, 15);
  for (const p of sample) {
    const ports = p.ports.map((x) => `${x.name || "?"}[${x.direction}:${x.connectionType}]`).join("; ");
    console.log(`  ${p.sku.padEnd(28)} ${p.displayName}`);
    console.log(`      ports: ${ports || "(none)"}`);
    console.log(`      docs : ${p.docs.length}`);
  }
  if (stats.writable > sample.length) console.log(`  … and ${n(stats.writable - sample.length)} more`);

  if (!args.includes("--apply")) {
    console.log(`\n  Report only. To apply: npm run davinci:enrich -- --apply --commit`);
    console.log(`  (a hosted DATABASE_URL target also needs --yes)\n`);
    return;
  }
  const res = await applyEnrichment(plans, { commit });
  if (!commit) {
    console.log(`\n  DRY RUN — nothing written. ${n(stats.writable)} rows would change. Add --commit.\n`);
  } else {
    console.log(`\n  WROTE ${n(res.written)} rows.\n`);
  }
}

main().then(
  () => process.exit(0),
  (e) => { console.error(e); process.exit(1); }
);
```

In `package.json`:

```json
    "davinci:enrich": "tsx scripts/davinci-enrich.ts",
```

- [ ] **Step 2: Verify the hosted gate refuses**

```bash
export PATH="$HOME/.local/node/bin:$PATH" && DATABASE_URL="postgres://fake/db" npx tsx scripts/davinci-enrich.ts --apply --commit; echo "exit=$?"
```

Expected: `Refusing to write to the HOSTED database without --yes.` and `exit=1`,
with no connection attempted.

- [ ] **Step 3: Verify the report against a scratch copy of the dev DB**

Never against `.data/pglite` directly.

```bash
export PATH="$HOME/.local/node/bin:$PATH"
ps aux | grep -E "tsx|next dev" | grep -v grep   # must be empty
SCRATCH=$(mktemp -d) && cp -R .data/pglite "$SCRATCH/pg"
PGLITE_PATH="$SCRATCH/pg" npx tsx scripts/davinci-enrich.ts --mfr=ETC
```

Expected: `scanned 10`, `matched 10`, `writable 10`. Dev's ten ETC rows all
match — that is the prefix-stripping in Task 1 doing its job.

- [ ] **Step 4: Commit**

```bash
git add scripts/davinci-enrich.ts package.json
git commit -m "feat(davinci): report/dry-run/commit CLI behind the two-flag gate (#162)"
```

---

### Task 8: Surface the documents in the catalog UI

**Files:**
- Modify: `src/app/(app)/catalog/page.tsx` (part detail — locate the block that renders `datasheetName`)
- Modify: `src/app/(app)/catalog/ports-editor.tsx`

- [ ] **Step 1: Render the document links**

Next to the existing uploaded-datasheet affordance, render `part.docs`:

```tsx
{!!part.docs?.length && (
  <div className="pk-field">
    <div className="pk-label">Manufacturer documents</div>
    <ul className="pk-list">
      {part.docs.map((d) => (
        <li key={d.url}>
          {/* Third-party URL from ETC's library: an outbound link only. Never
              fetched server-side, never proxied — unlike datasheetBlobKey,
              which is Peak's own upload behind /api/part-datasheet. */}
          <a href={d.url} target="_blank" rel="noopener noreferrer">
            {d.label || d.kind} ↗
          </a>{" "}
          <span className="pk-mono pk-dim">{d.kind}</span>
        </li>
      ))}
    </ul>
  </div>
)}
```

Match the file's existing class names and markup idiom rather than these
placeholders — read the surrounding JSX first.

- [ ] **Step 2: Warn before a manual override**

In `ports-editor.tsx`, when the part carries `davinci`, render a read-only note
above the rows:

```tsx
{part.davinci && (
  <p className="pk-hint">
    These ports came from ETC&rsquo;s DaVinci library ({new Date(part.davinci.enrichedAt).toLocaleDateString()}).
    Editing them here means a future enrichment run will leave your version alone.
  </p>
)}
```

- [ ] **Step 3: Verify in the browser**

Start the dev server with `preview_start` (never `npm run dev` via Bash), open
a part that has been enriched on a scratch datadir, and confirm the links
render and open. Screenshot the result.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/catalog/page.tsx" "src/app/(app)/catalog/ports-editor.tsx"
git commit -m "feat(catalog): show manufacturer documents and flag DaVinci-sourced ports (#162)"
```

---

### Task 9: Gates, then the production run

- [ ] **Step 1: Run all four gates against a baseline**

Establish the baseline by comparing against `origin/main` in a separate
checkout — never `git stash`.

```bash
export PATH="$HOME/.local/node/bin:$PATH"
npx tsc --noEmit
npm run test:specs 2>&1 | tail -3
npm run test:smoke 2>&1 | tail -3
npx eslint . 2>&1 | tail -3
```

Report real counts. `test:specs` should be `0 FAIL` with the PASS count up by
roughly 60.

- [ ] **Step 2: Report against production, read-only**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
set -a && . ./.env.production.local && set +a
npx tsx scripts/davinci-enrich.ts --mfr=ETC
```

Expected, from the verified 2026-09-24 end-to-end run: `scanned 3,959`, `matched ~2,917`,
`writable ~2,917`, `skipped, has ports 0`, `unmatched ~1,042`. **Report these to
Jeff and stop.** A materially different number means something changed and is
worth understanding before writing.

- [ ] **Step 3: Back up, dry-run, then commit — only on Jeff's go-ahead**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
set -a && . ./.env.production.local && set +a
npm run db:export                                              # backup first
npx tsx scripts/davinci-enrich.ts --mfr=ETC --apply            # dry run
npx tsx scripts/davinci-enrich.ts --mfr=ETC --apply --commit --yes
```

- [ ] **Step 4: Verify the write and confirm prices moved nothing**

```bash
export PATH="$HOME/.local/node/bin:$PATH"
set -a && . ./.env.production.local && set +a
npx tsx -e '
import postgres from "postgres";
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false });
console.table(await sql`select
  count(*) filter (where jsonb_array_length(coalesce(doc->\x27ports\x27,\x27[]\x27::jsonb))>0)::int ported,
  count(*) filter (where doc ? \x27docs\x27)::int with_docs,
  count(*) filter (where doc ? \x27davinci\x27)::int enriched,
  count(*) filter (where (doc->>\x27list\x27)::numeric > 0)::int priced
  from catalog_parts where doc->>\x27mfr\x27=\x27ETC\x27 and not deleted`);
await sql.end();'
```

`priced` must still read 3,959.

- [ ] **Step 5: Log the decisions and close the punch item**

Append D209 (the enrichment shipped, with the real run's numbers) to
`DECISIONS.md`, mark #162 DONE in `PUNCHLIST.md`, and file the separate punch
item for "#39's starter set never reached production".

```bash
git add DECISIONS.md PUNCHLIST.md
git commit -m "docs: close #162 and log D209 (DaVinci enrichment is live)"
git push origin main
```
