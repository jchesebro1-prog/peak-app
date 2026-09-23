import { type Port, type PortDirection } from "@/lib/catalog-connect";

/**
 * Port shapes — what a class of device plugs into (#159, D194).
 *
 * These were private to scripts/draft-starter-set.ts. A human read real
 * datasheets to write them, which makes them the domain knowledge this whole
 * feature rests on; the rules engine only decides WHICH shape applies to a
 * part, it never invents one. Two drifting copies would produce a run that
 * looks clean and is quietly wrong, so there is exactly one — same reasoning
 * as scripts/daylite-ids.ts.
 *
 * Every connectionType below MUST be a member of CONNECTION_TYPES
 * (lib/catalog-connect). validateDeviceWire() resolves against that
 * vocabulary, so a typo here does not look wrong — it makes every part using
 * this shape unwireable against everything, silently. A test asserts this.
 */

/**
 * Exported alongside the shapes: two starter-set picks (Shure MXA901W-R
 * bundle, Shure IMXF5) need a one-off port that doesn't match any shape
 * above, and previously called this helper directly from
 * scripts/draft-starter-set.ts. Kept as the single source rather than
 * duplicated there.
 */
export const p = (name: string, direction: PortDirection, connectionType: string, count?: number): Port =>
  count !== undefined ? { name, direction, connectionType, count } : { name, direction, connectionType };

export const consolePorts = (): Port[] => [
  p("DMX Out", "out", "DMX512 (5-pin XLR)", 2),
  p("Network (sACN/Art-Net)", "io", "sACN/Art-Net (etherCON/Cat6)"),
];

export const wingPorts = (): Port[] => [
  p("Console Link (sACN/Art-Net)", "io", "sACN/Art-Net (etherCON/Cat6)"),
];

export const dimmerRackPorts = (outCount: number): Port[] => [
  p("DMX In", "in", "DMX512 (5-pin XLR)"),
  p("RDM", "io", "RDM"),
  p("Dimmed Power Out", "out", "stage pin", outCount),
];

export const conventionalFixturePorts = (): Port[] => [p("Power In", "in", "Edison")];

export const ledFixturePorts = (): Port[] => [
  p("DMX In", "in", "DMX512 (5-pin XLR)"),
  p("DMX Thru", "out", "DMX512 (5-pin XLR)"),
  p("Power In", "in", "powerCON/True1"),
];

export const ptzCameraPorts = (video: "HDMI" | "SDI/BNC"): Port[] => [p("Video Out", "out", video)];

export const encoderDecoderPorts = (): Port[] => [p("HDMI", "io", "HDMI")];

export const sdiCardPorts = (n: number): Port[] => [p("SDI In", "in", "SDI/BNC", n)];

export const captureOnlyPorts = (): Port[] => [p("HDMI In", "in", "HDMI")];

export const matrixPorts = (inN: number, outN: number, io: "HDMI" | "HDBaseT (Cat6a)" = "HDBaseT (Cat6a)"): Port[] => [
  p("HDMI In", "in", "HDMI", inN),
  p(io === "HDMI" ? "HDMI Out" : "HDBaseT Out", "out", io, outN),
];

export const hdbasetMatrixPorts = (inN: number, outN: number): Port[] => [
  p("HDBaseT In", "in", "HDBaseT (Cat6a)", inN),
  p("HDBaseT Out", "out", "HDBaseT (Cat6a)", outN),
];

export const extenderKitPorts = (): Port[] => [
  p("HDMI In (TX)", "in", "HDMI"),
  p("HDBaseT Out (RX)", "out", "HDBaseT (Cat6a)"),
];

export const splitterPorts = (outN: number): Port[] => [
  p("HDMI In", "in", "HDMI"),
  p("HDMI Out", "out", "HDMI", outN),
];

export const passiveSpeakerPorts = (): Port[] => [p("Audio In", "in", "speakON NL2")];

export const seventyVSpeakerPorts = (): Port[] => [p("Audio In (70V)", "in", "70V pair")];

export const poweredSpeakerPorts = (): Port[] => [
  p("Audio In", "in", "XLR line/mic"),
  p("Power In", "in", "powerCON/True1"),
];

export const mixerAllInOnePorts = (): Port[] => [
  p("XLR In", "in", "XLR line/mic"),
  p("XLR Out", "out", "XLR line/mic"),
  p("Network (Dante/AES67)", "io", "Dante/AES67 (Cat6)"),
];

export const mixSurfacePorts = (): Port[] => [p("Network to MixRack (Dante/AES67)", "io", "Dante/AES67 (Cat6)")];

export const mixRackPorts = (inN: number, outN: number): Port[] => [
  p("XLR In", "in", "XLR line/mic", inN),
  p("XLR Out", "out", "XLR line/mic", outN),
  p("Network (Dante/AES67)", "io", "Dante/AES67 (Cat6)"),
];

export const mechanicalPorts = (): Port[] => [];

export const motorHoistPorts = (): Port[] => [
  p("Motor Power In", "in", "motor power"),
  p("Pendant Control In", "in", "low-voltage pendant control"),
];

/* ---- new shapes (D197) ----
   Added deliberately, not derived by the engine. Each covers a device class
   that is classifiable from descriptions but had nowhere to land: 267 wireless
   receivers, 97 amplifiers, 27 DSPs across the in-scope brands. Reviewed
   alongside the rules that use them. */

/** Install amplifier: line-level in, speaker-level out, network for control. */
export const amplifierPorts = (outCount: number): Port[] => [
  p("Line In", "in", "XLR line/mic"),
  p("Speaker Out", "out", "speakON NL4", outCount),
  p("Network (Dante/AES67)", "io", "Dante/AES67 (Cat6)"),
];

/** Wireless mic receiver: antennas are not modelled; the audio out is. */
export const wirelessReceiverPorts = (outCount: number): Port[] => [
  p("Audio Out", "out", "XLR line/mic", outCount),
  p("Network", "io", "Dante/AES67 (Cat6)"),
];

/** Fixed-architecture DSP / processor. */
export const dspPorts = (inN: number, outN: number): Port[] => [
  p("Analog In", "in", "XLR line/mic", inN),
  p("Analog Out", "out", "XLR line/mic", outN),
  p("Network (Dante/AES67)", "io", "Dante/AES67 (Cat6)"),
];

/** Every shape, called with representative arguments. Used only by the
 *  vocabulary guard test — it is the one place that can prove no shape emits
 *  a connection type outside CONNECTION_TYPES. */
export const ALL_SHAPES: Record<string, () => Port[]> = {
  consolePorts, wingPorts,
  dimmerRackPorts: () => dimmerRackPorts(12),
  conventionalFixturePorts, ledFixturePorts,
  ptzCameraPorts: () => ptzCameraPorts("SDI/BNC"),
  encoderDecoderPorts,
  sdiCardPorts: () => sdiCardPorts(4),
  captureOnlyPorts,
  matrixPorts: () => matrixPorts(4, 4),
  hdbasetMatrixPorts: () => hdbasetMatrixPorts(4, 4),
  extenderKitPorts,
  splitterPorts: () => splitterPorts(4),
  passiveSpeakerPorts, seventyVSpeakerPorts, poweredSpeakerPorts,
  mixerAllInOnePorts, mixSurfacePorts,
  mixRackPorts: () => mixRackPorts(16, 8),
  mechanicalPorts, motorHoistPorts,
  amplifierPorts: () => amplifierPorts(4),
  wirelessReceiverPorts: () => wirelessReceiverPorts(2),
  dspPorts: () => dspPorts(8, 8),
};
