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
  {
    id: "powercon-power",
    label: "powerCON power",
    connectionTypes: ["powerCON/True1", "Edison", "stage pin", "Socapex", "bare-end"],
  },
  { id: "motor-power", label: "Motor power", connectionTypes: ["motor power", "low-voltage pendant control"] },
];

/** stored ?? defaults — always a fresh array copy so a mutating caller can
 *  never corrupt the shared DEFAULT_WIRE_TYPES singleton. */
export function resolveWireTypes(stored?: WireType[]): WireType[] {
  return stored ?? [...DEFAULT_WIRE_TYPES];
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
