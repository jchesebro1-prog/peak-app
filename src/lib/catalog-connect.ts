/**
 * Ports + wire-type registry + connection compatibility (punch #39, catalog
 * beta build-out, Task 3).
 *
 * `CatalogPart.ports` (src/lib/stores/catalog.ts) lets a device declare its
 * connectors; `WireType` is the admin-editable registry of cable kinds a
 * job can carry, each tagged with the `connectionType` strings it satisfies.
 * Grid wiring validation (Task 4) is the consumer: it calls `canConnect` to
 * decide whether two device ports may be patched together, and
 * `compatibleWireTypes` to offer the right cable choices for a run.
 *
 * `WireType.connectionTypes` are sourced from the same taxonomy — see
 * CONNECTION_TYPES below.
 */

export type PortDirection = "in" | "out" | "io";

export type Port = {
  name: string;
  direction: PortDirection;
  connectionType: string;
  count?: number;
};

export type WireType = {
  id: string;
  label: string;
  connectionTypes: string[];
  cableSku?: string;
  dollarsPerFt?: number;
  /**
   * Opt-in: any connector in this family physically mates with any other in
   * it, so `canConnect` accepts a cross-type pair inside the family instead of
   * demanding exact `connectionType` equality.
   *
   * This is deliberately NOT the default for a wire type. `connectionTypes`
   * answers "what cable carries this signal", which is a different question
   * from "what mates with what" — `cat6` carries Dante audio AND HDBaseT
   * video, `powercon-power` carries Edison AND Socapex, and neither pair
   * should ever be wireable. Only flag a family whose members really do
   * inter-operate at the connector, and say why in a comment.
   */
  interchangeable?: true;
};

/**
 * Jeff-prunable taxonomy of connection types, verbatim from the spec, grouped
 * by trade for readability. This is the source of truth every
 * `WireType.connectionTypes` entry (and every `Port.connectionType`) must
 * resolve against.
 */
export const CONNECTION_TYPES: readonly string[] = [
  // power
  "powerCON/True1",
  "Edison",
  "stage pin",
  "Socapex",
  "bare-end",
  // lighting data
  "DMX512 (5-pin XLR)",
  "sACN/Art-Net (etherCON/Cat6)",
  "RDM",
  "contact closure",
  // audio
  "XLR line/mic",
  "speakON NL2",
  "speakON NL4",
  "speakON NL8",
  "Dante/AES67 (Cat6)",
  "AES/EBU",
  "70V pair",
  // video
  "HDMI",
  "SDI/BNC",
  "HDBaseT (Cat6a)",
  "fiber",
  // rigging
  "motor power",
  "low-voltage pendant control",
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
];

/**
 * Seed wire-type registry. Each entry maps to the connection type(s) it can
 * carry; admins can override this list via `AppSettingsData.wireTypes`
 * (see resolveWireTypes below).
 */
export const DEFAULT_WIRE_TYPES: WireType[] = [
  { id: "dmx-5pin", label: "DMX 5-pin", connectionTypes: ["DMX512 (5-pin XLR)"] },
  {
    id: "cat6",
    label: "Cat6 (network/Dante/sACN/HDBaseT)",
    connectionTypes: [
      "sACN/Art-Net (etherCON/Cat6)",
      "Dante/AES67 (Cat6)",
      "HDBaseT (Cat6a)",
    ],
  },
  {
    id: "speaker-pair",
    label: "Speaker pair",
    connectionTypes: ["speakON NL2", "speakON NL4", "speakON NL8", "70V pair"],
    // The only interchangeable family (#159 gate review). Amplifiers ship
    // speakON NL4 outs, passive cabinets present NL2 ins, and 70V taps land
    // on bare pairs — in the field these are all the same two conductors,
    // mated with an adapter or a re-terminated tail, and an installer wires
    // them together every day. Requiring exact equality made every ported
    // amplifier unwireable to every ported speaker, which is why this exists.
    interchangeable: true,
  },
  { id: "xlr-audio", label: "XLR audio", connectionTypes: ["XLR line/mic", "AES/EBU"] },
  { id: "sdi-coax", label: "SDI coax", connectionTypes: ["SDI/BNC"] },
  { id: "hdmi", label: "HDMI", connectionTypes: ["HDMI"] },
  // Pre-existing CONNECTION_TYPES entries the DaVinci import can emit (D162
  // orphan check) that had no carrying wire type before this task — without
  // one the Grid validates the wire but can offer no cable for it.
  { id: "contact-closure", label: "Contact closure", connectionTypes: ["contact closure"] },
  { id: "fiber", label: "Fiber", connectionTypes: ["fiber"] },
  {
    id: "powercon-power",
    label: "powerCON power",
    connectionTypes: ["powerCON/True1", "Edison", "stage pin", "Socapex", "bare-end", "line power (unspecified)"],
  },
  { id: "motor-power", label: "Motor power", connectionTypes: ["motor power", "low-voltage pendant control"] },
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
  // A convenience bundle, not one cable: MCX, LSH, Sense, CANbus, BluesSystem
  // low voltage and generic control are six physically different runs. Split it
  // into per-family wire types BEFORE setting any `dollarsPerFt` or `cableSku`
  // on it — a price or a part number here would be charged to whichever of the
  // six a Grid route happens to use, and five of them would be wrong.
  { id: "etc-control", label: "ETC control", connectionTypes: ["ETC Control/SafetyLink (MCX)", "ETC LSH control", "ETC Sense", "ETC CANbus", "ETC BluesSystem low voltage", "ETC control (generic)"] },
  { id: "etc-wireless", label: "ETC wireless (no cable)", connectionTypes: ["ETC Echoflex (wireless)", "ETC Multiverse (wireless DMX)", "ETC MeshConnect (wireless)"] },
];

/** stored ?? defaults — always a fresh array copy so a mutating caller can
 *  never corrupt the shared DEFAULT_WIRE_TYPES singleton. */
export function resolveWireTypes(stored?: WireType[]): WireType[] {
  return stored ?? [...DEFAULT_WIRE_TYPES];
}

const MAX_WIRE_TYPES = 60;

/**
 * Validate + normalize a whole-list save from the Grid Settings "Wire
 * types" editor (the same full-replacement idiom as
 * cleanGridCategoryShapes/resolveCategoryShapes): the caller posts every
 * row, and this is the ONLY place that decides what's actually stored.
 *
 * - `id`/`label` trimmed, capped, defaulted (`label` falls back to `id`).
 * - `connectionTypes` filtered to the known CONNECTION_TYPES vocabulary —
 *   an unrecognized token is dropped silently rather than stored broken,
 *   same as parsePortsField's CONNECTION_SET check on the catalog side. A
 *   row left with none is dropped entirely: a wire type that carries
 *   nothing can never satisfy canConnect and is never offered by
 *   compatibleWireTypes, so keeping it would only confuse the editor.
 * - `dollarsPerFt` — a finite number ≥ 0, or omitted.
 * - `interchangeable` — stored only as literal `true` (never `false`), to
 *   match the type's `true | undefined` shape.
 * - Rows past MAX_WIRE_TYPES are dropped, same cap idiom as
 *   cleanGridCategoryShapes.
 * - Duplicate `id`s: first one wins.
 *
 * An empty result collapses to `null` (clears the settings key, so
 * resolveWireTypes falls back to the shipped DEFAULT_WIRE_TYPES seed) rather
 * than storing `[]` — the same reasoning as cleanGridCategoryShapes: a
 * stored empty array is indistinguishable from "admin meant to delete
 * everything", and "Restore defaults" followed by Save posts the seed as an
 * explicit dense array, never empty, so this path is never hit by that flow.
 */
export function cleanWireTypes(rows: unknown): WireType[] | null {
  const CONNECTION_SET = new Set(CONNECTION_TYPES);
  const seenIds = new Set<string>();
  const clean: WireType[] = [];
  for (const raw of Array.isArray(rows) ? rows : []) {
    if (clean.length >= MAX_WIRE_TYPES) break;
    const r = raw as Record<string, unknown> | null;
    if (!r || typeof r !== "object") continue;
    const id = String(r.id ?? "").trim().slice(0, 60);
    if (!id || seenIds.has(id)) continue;
    const connectionTypes = (Array.isArray(r.connectionTypes) ? r.connectionTypes : [])
      .map((c) => String(c ?? "").trim())
      .filter((c) => CONNECTION_SET.has(c));
    if (!connectionTypes.length) continue;
    const label = String(r.label ?? "").trim().slice(0, 80) || id;
    const wt: WireType = { id, label, connectionTypes };
    const cableSku = String(r.cableSku ?? "").trim().slice(0, 60);
    if (cableSku) wt.cableSku = cableSku;
    const dpf = Number(r.dollarsPerFt);
    if (Number.isFinite(dpf) && dpf >= 0) wt.dollarsPerFt = dpf;
    if (r.interchangeable === true) wt.interchangeable = true;
    seenIds.add(id);
    clean.push(wt);
  }
  return clean.length ? clean : null;
}

/**
 * Two ports may connect when the directions complement (at least one side is
 * bidirectional "io", or the two differ — in vs out; same-direction in/in or
 * out/out never connects) AND the connectors mate: either the same
 * `connectionType`, or two members of the same `interchangeable` wire-type
 * family (today: `speaker-pair` only — see the flag's doc comment).
 *
 * Pure and synchronous: the wire-type registry is an optional defaulted
 * parameter so a caller holding the admin-edited list (resolveWireTypes)
 * can pass it, exactly like `driveMiles(a, b, travel)` in lib/geo.ts.
 */
export function canConnect(a: Port, b: Port, types: WireType[] = DEFAULT_WIRE_TYPES): boolean {
  const directionOk = a.direction === "io" || b.direction === "io" || a.direction !== b.direction;
  if (!directionOk) return false;
  if (a.connectionType === b.connectionType) return true;
  return types.some(
    (wt) =>
      wt.interchangeable &&
      wt.connectionTypes.includes(a.connectionType) &&
      wt.connectionTypes.includes(b.connectionType)
  );
}

/** Wire types (from `types`) that carry the given connection type. */
export function compatibleWireTypes(conn: string, types: WireType[]): WireType[] {
  return types.filter((wt) => wt.connectionTypes.includes(conn));
}

/**
 * Grid wiring validation (Task 4): may a route drawn from `fromPart` to
 * `toPart` be treated as a validated device-to-device wire?
 *
 * Scans `fromPart.ports` × `toPart.ports` in order and returns the first
 * `canConnect`-satisfying pair's connectionType. When either side has no
 * ports at all, that's reported with the same `{ ok: false }` shape but the
 * "no connection metadata" reason — callers (the Grid editor / addRoute)
 * treat THAT specific reason as an allowed case (the catalog isn't fully
 * migrated to ports yet, and an un-migrated device must never block a
 * route). Only a refusal where both sides HAD ports and still found no
 * compatible pair is a real validation failure.
 *
 * `types` is threaded straight through to `canConnect` (same defaulted-
 * parameter shape) so a caller with the admin-edited wire-type registry gets
 * that registry's `interchangeable` families. When a pair matches across an
 * interchangeable family rather than exactly, the stamped `connectionType` is
 * still `a.connectionType` — the FROM/output side. That is deliberate: the
 * source end is what the run is terminated to and what the cable BOM prices,
 * so an NL4 amp feeding an NL2 cabinet stamps `speakON NL4`.
 */
export function validateDeviceWire(
  fromPart: { ports?: Port[] },
  toPart: { ports?: Port[] },
  types: WireType[] = DEFAULT_WIRE_TYPES
): { ok: true; connectionType: string } | { ok: false; reason: string } {
  const fromPorts = fromPart.ports || [];
  const toPorts = toPart.ports || [];
  if (fromPorts.length === 0 || toPorts.length === 0) {
    return { ok: false, reason: "no connection metadata" };
  }
  for (const a of fromPorts) {
    for (const b of toPorts) {
      if (canConnect(a, b, types)) return { ok: true, connectionType: a.connectionType };
    }
  }
  return { ok: false, reason: "no compatible port pair" };
}
