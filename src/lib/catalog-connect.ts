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
};

/**
 * Jeff-prunable taxonomy of connection types, verbatim from the spec, grouped
 * by trade for readability. This is the source of truth every
 * `WireType.connectionTypes` entry (and every `Port.connectionType`) must
 * resolve against.
 */
export const CONNECTION_TYPES = [
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
] as const satisfies readonly string[];

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
 * Two ports may connect when they share a connectionType and at least one
 * side is bidirectional ("io"), or the two directions differ (in vs out).
 * Same-direction in/in or out/out never connects.
 */
export function canConnect(a: Port, b: Port): boolean {
  if (a.connectionType !== b.connectionType) return false;
  return a.direction === "io" || b.direction === "io" || a.direction !== b.direction;
}

/** Wire types (from `types`) that carry the given connection type. */
export function compatibleWireTypes(conn: string, types: WireType[]): WireType[] {
  return types.filter((wt) => wt.connectionTypes.includes(conn));
}
