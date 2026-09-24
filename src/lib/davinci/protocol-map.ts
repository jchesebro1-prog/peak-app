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
  // Power480V/Power208V/AuxPower* used to collapse into a shared "bare-end"
  // whenever the connector was hardwired (Terminal Block/Screw Terminal/
  // Flying Leads), which let a low-voltage auxiliary bus validate against a
  // 480V hoist feeder as the same connection type. Each voltage class now
  // keeps its own pass-through identity so voltage classes can never match
  // each other; only generic, unspecified Power still lets the connector
  // pick a Peak type.
  "aa07559e-6609-4ec6-8df3-8990d6bc9909": { kind: "power" }, // Power | POWER | 2195
  "25636fee-a970-4c76-b5cc-7de92724a664": { kind: "passthrough", connectionType: "ETC 480V feeder" }, // Power480V | 26
  "e4309323-4f8d-4dc6-9f90-7607696e951b": { kind: "passthrough", connectionType: "ETC 480V feeder" }, // Power480VFP | 3
  "ca96a25e-b72f-4bb6-a628-f83dfb1caa83": { kind: "passthrough", connectionType: "ETC 208V feeder" }, // Power208V | 21
  "29a18143-da9b-47c9-8b7f-6b1b4d71e696": { kind: "passthrough", connectionType: "ETC 208V feeder" }, // Power208VFP | 3
  "1a0f1e55-53a5-452a-8294-9f8fd5c60783": { kind: "passthrough", connectionType: "ETC auxiliary power" }, // AuxPowerReciever | AUXILIARY | 72 | co-occurs with the other two on one Bus
  "0c508822-833d-4169-b3cf-3fc1bd667947": { kind: "passthrough", connectionType: "ETC auxiliary power" }, // AuxiliaryPower | AUXILIARY | 39
  "9c23dfb5-6ec6-4afc-818a-e6de8acf3bcc": { kind: "passthrough", connectionType: "ETC auxiliary power" }, // ParadigmAuxiliaryPower | AUXILIARY | 14
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
