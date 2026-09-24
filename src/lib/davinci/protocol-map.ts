import type { PortDirection } from "@/lib/catalog-connect";

export type ProtocolMapping =
  | { kind: "peak"; connectionType: string }
  | { kind: "peak-by-connector"; powercon: string; hardwired: string; generic: string }
  | { kind: "passthrough"; connectionType: string }
  | { kind: "exclude"; why: string };

/**
 * The DaVinci export uses UUIDs for protocols. Keep this table explicit and
 * fail closed when ETC adds one: an unreviewed protocol must never silently
 * become a wrong Peak connector type. The aliases below are also accepted by
 * fixture exports and make the pure mapper useful before the first full
 * library extract is checked in.
 */
export const PROTOCOL_MAP: Readonly<Record<string, ProtocolMapping>> = {
  "power": { kind: "peak-by-connector", powercon: "powerCON/True1", hardwired: "bare-end", generic: "line power (unspecified)" },
  "dmx": { kind: "peak", connectionType: "DMX512 (5-pin XLR)" },
  "dali": { kind: "passthrough", connectionType: "DALI" },
  "0-10v": { kind: "passthrough", connectionType: "0-10V" },
  "echoconnect": { kind: "passthrough", connectionType: "EchoConnect" },
  "linkconnect": { kind: "passthrough", connectionType: "LinkConnect" },
  "f-drive-d4": { kind: "passthrough", connectionType: "F-Drive D4" },
  "f-drive-d2": { kind: "passthrough", connectionType: "F-Drive D2" },
  "f-drive-d1ho": { kind: "passthrough", connectionType: "F-Drive D1HO" },
  "multiverse": { kind: "passthrough", connectionType: "Multiverse" },
  "usb": { kind: "passthrough", connectionType: "USB" },
  "midi": { kind: "passthrough", connectionType: "MIDI" },
};

export const DIRECTION_MAP: Readonly<Record<string, PortDirection>> = {
  Input: "in", Output: "out", Bidirectional: "io", Bus: "io", Configurable: "io",
  input: "in", output: "out", bidirectional: "io", bus: "io", configurable: "io",
};

export function mapProtocol(protocolId: string, connectorLabel: string): { connectionType: string } | { excluded: true } {
  const mapping = PROTOCOL_MAP[protocolId];
  if (!mapping) throw new Error(`Unknown DaVinci protocol UUID: ${protocolId}`);
  if (mapping.kind === "exclude") return { excluded: true };
  if (mapping.kind === "peak-by-connector") {
    const c = connectorLabel.toLowerCase();
    return { connectionType: c.includes("powercon") || c.includes("true1") ? mapping.powercon : c.includes("terminal") || c.includes("hard") ? mapping.hardwired : mapping.generic };
  }
  return { connectionType: mapping.connectionType };
}

export function directionFor(value: string): PortDirection {
  const direction = DIRECTION_MAP[value] || DIRECTION_MAP[value.trim()];
  if (!direction) throw new Error(`Unknown DaVinci port direction: ${value}`);
  return direction;
}
