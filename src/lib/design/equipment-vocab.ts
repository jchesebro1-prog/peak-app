/**
 * The equation item vocabulary (#211, D301). Every item compute()
 * (quick/engine.ts) can emit, keyed `system:itemKey` — stable keys, never
 * display text. The Equipment map, the Auto intake and saved overrides all key
 * on these, so a relabel never orphans a mapping. `label` (and `unit`) is the
 * ONE source of an item's name: compute() reads it by key (#233), so Quick
 * Design, Auto cards and the Equipment map can never disagree. Pure and
 * dollar-free: client components may import it. It imports only TYPES from
 * the engine — the engine imports values from here.
 *
 * `place` is how Auto lands a row on the plan: "each" = one marker per unit,
 * "lot" = one marker carrying the quantity (count/length hardware), "curtain"
 * = a curtain drop-in on the mapped fabric, "none" = never Auto-placed
 * (Controls / Acoustical / Pit are not Grid scopes; Quick Design still prices
 * them). `search` feeds the Equipment map's suggested catalog matches.
 */
import type { SysKey } from "@/app/(app)/design/quick/engine";

export type EquipPlace = "each" | "lot" | "curtain" | "none";
export type CurtainRowType = { drape: "Draw" | "Legs" | "Border" | "Rear"; grid: "Draw" | "Leg" | "Border" | "Full" };

export type EquipRowDef = {
  key: string;
  system: SysKey;
  itemKey: string;
  label: string;
  unit: string;
  place: EquipPlace;
  search: string[];
  curtain?: CurtainRowType;
  /** #231: emitted by the wire-pull step (wire-labor.ts withWirePull), not by compute(). */
  derived?: "wirePull";
};

function row(
  system: SysKey,
  itemKey: string,
  label: string,
  unit: string,
  place: EquipPlace,
  search: string[],
  curtain?: CurtainRowType
): EquipRowDef {
  return { key: `${system}:${itemKey}`, system, itemKey, label, unit, place, search, ...(curtain ? { curtain } : {}) };
}

/** #231: a wire system's "Wire pull" row — footage from venue size × runs × tier (wire-labor.ts). */
function wireRow(system: SysKey, place: EquipPlace, search: string[]): EquipRowDef {
  return { key: `${system}:wirePull`, system, itemKey: "wirePull", label: "Wire pull", unit: "ft", place, search, derived: "wirePull" };
}

export const EQUIPMENT_ROWS: readonly EquipRowDef[] = [
  // Rigging — motorized
  row("rigging", "electricHoist", "Electric hoist", "ea", "each", ["hoist", "motor"]),
  row("rigging", "lowCapHoist", "Low-capacity hoist", "ea", "each", ["hoist", "motor"]),
  row("rigging", "highCapHoist", "High-capacity hoist", "ea", "each", ["hoist", "motor"]),
  row("rigging", "varSpeedHoist", "Variable-speed hoist", "ea", "each", ["variable", "hoist", "motor"]),
  // Rigging — dead hung
  row("rigging", "riggingPoint", "Rigging point", "ea", "each", ["rigging point", "beam clamp", "shackle"]),
  // Rigging — counterweight
  row("rigging", "headblock", "Headblock", "ea", "each", ["head block", "headblock"]),
  row("rigging", "footblock", "Footblock", "ea", "lot", ["foot block", "footblock", "tension"]),
  row("rigging", "arbor", "Arbor", "ea", "lot", ["arbor"]),
  row("rigging", "tbarTrack", "T-bar track", "ea", "lot", ["t-bar", "track"]),
  row("rigging", "lockRail", "Lock rail", "ea", "lot", ["rope lock", "lock rail"]),
  row("rigging", "handline", "Handline", "ft", "lot", ["handline", "hand line", "rope"]),
  row("rigging", "loftblock", "Loftblock", "ea", "lot", ["loft block", "loftblock"]),
  // Rigging — shared by dead hung + counterweight
  row("rigging", "pipe", "Pipe", "ft", "lot", ["pipe", "batten"]),
  row("rigging", "aircraftCable", "Suspension Method", "ft", "lot", ["aircraft cable", "wire rope"]),
  row("rigging", "chainWrap", "Batten Termination", "ea", "lot", ["chain"]),
  row("rigging", "terminationKit", "Beginning Termination", "ea", "lot", ["termination", "swage", "thimble"]),
  // Curtains — the four drapes resolve per area from a mapped Fabric part
  row("curtains", "draw", "Draw", "ea", "curtain", ["velour", "drape"], { drape: "Draw", grid: "Draw" }),
  row("curtains", "legs", "Leg", "ea", "curtain", ["velour", "leg"], { drape: "Legs", grid: "Leg" }),
  row("curtains", "border", "Border", "ea", "curtain", ["velour", "border"], { drape: "Border", grid: "Border" }),
  row("curtains", "fullstage", "Full stage", "ea", "curtain", ["velour", "traveler"], { drape: "Rear", grid: "Full" }),
  row("curtains", "scenerytrack", "Scenery track", "ft", "lot", ["track", "traveler"]),
  // Lighting
  row("lighting", "par", "Par", "ea", "each", ["par", "wash"]),
  row("lighting", "front", "Front", "ea", "each", ["ellipsoidal", "profile", "leko"]),
  row("lighting", "cyc", "Cyc", "ea", "each", ["cyc"]),
  row("lighting", "side", "Side light", "ea", "each", ["wash", "side"]),
  row("lighting", "automated", "Automated", "ea", "each", ["moving", "automated"]),
  // #233: was controls:outputStation ("Output station"), now a Fixtures item.
  // #233 late: qty = ⌈fixtures × per fixture × tier ×⌉ (cable-package.ts).
  // D393: an old Output-station part mapping or typed Output-station qty does
  // NOT carry to Cable Package — it's now counted per cable, not per the old
  // row's math, so the old figure would misprice it. Cable Package starts
  // unmapped (Incomplete until Jeff maps it in Grid Settings).
  row("lighting", "cablePackage", "Cable Package", "ea", "lot", ["cable", "jumper", "extension"]),
  // Controls (Quick Design only)
  row("controls", "console", "Console", "ea", "none", ["console"]),
  row("controls", "consoleTouch", "Console Accessories", "ea", "none", ["touch", "monitor"]),
  row("controls", "batteryBackup", "Emergency", "ea", "none", ["ups", "battery"]),
  row("controls", "processor", "Power Controls – Production", "ea", "none", ["processor", "architectural"]),
  row("controls", "button", "Power Controls – Architectural", "ea", "none", ["button", "station"]),
  row("controls", "archTouch", "Architectural Controls", "ea", "none", ["touch"]),
  row("controls", "inputStation", "DMX Distribution", "ea", "none", ["input", "node"]),
  row("controls", "distro", "Labor", "ea", "none", ["distro", "switch", "gateway"]),
  // Audio
  row("audio", "lineArray", "Line-array loudspeaker", "ea", "each", ["line array", "loudspeaker", "speaker"]),
  row("audio", "subwoofer", "Subwoofer", "ea", "each", ["subwoofer"]),
  row("audio", "mixerDsp", "Digital mixer, DSP & amplifiers", "lot", "each", ["mixer", "dsp", "amplifier"]),
  // Video
  row("video", "projector", "Laser projector, 4K", "ea", "each", ["projector"]),
  row("video", "screen", "Projection screen / LED wall", "lot", "each", ["screen", "led wall"]),
  row("video", "processor", "Video processor & switcher", "lot", "each", ["switcher", "scaler", "video processor"]),
  // Acoustical shell (Quick Design only)
  row("acoustical", "tower", "Tower", "ea", "none", ["shell", "tower"]),
  row("acoustical", "ceiling", "Ceiling", "ea", "none", ["shell", "ceiling"]),
  row("acoustical", "transport", "Transport", "ea", "none", ["cart", "transport"]),
  // Pit filler (Quick Design only)
  row("pit", "legged", "Legged pit filler deck", "sqft", "none", ["pit", "deck"]),
  row("pit", "clearspan", "Clear-span pit filler deck", "sqft", "none", ["pit", "deck"]),
  // Wire pull (#231) — one per wire system. The Equipment map groups rows by
  // system, so each lands at the end of its own system's group.
  wireRow("rigging", "lot", ["wire rope", "cable"]),
  wireRow("lighting", "lot", ["dmx", "cable", "wire"]),
  wireRow("controls", "none", ["network", "cable", "wire"]),
  wireRow("audio", "lot", ["speaker cable", "cable", "wire"]),
  wireRow("video", "lot", ["sdi", "hdmi", "cable"]),
];

export const EQUIPMENT_ROW_BY_KEY: ReadonlyMap<string, EquipRowDef> = new Map(EQUIPMENT_ROWS.map((r) => [r.key, r]));

/**
 * #233 late (Jeff 2026-09-27) — the lighting FIXTURE rows: the lines whose
 * total quantity sizes the Cable Package (cable-package.ts). Not the Cable
 * Package itself, Wire pull, or any Controls row (consoles, DMX, power).
 * A new fixture row joins here explicitly.
 */
export const LIGHTING_FIXTURE_KEYS: readonly string[] = Object.freeze([
  "lighting:par",
  "lighting:front",
  "lighting:cyc",
  "lighting:side",
  "lighting:automated",
]);

export function isLightingFixtureKey(key: unknown): boolean {
  return typeof key === "string" && LIGHTING_FIXTURE_KEYS.includes(key);
}

export const EQUIP_SYSTEM_LABEL: Record<SysKey, string> = {
  rigging: "Rigging",
  curtains: "Curtains",
  lighting: "Lighting",
  controls: "Controls",
  audio: "Audio",
  video: "Video",
  acoustical: "Acoustical",
  pit: "Pit",
};

/**
 * #233 — a moved row's OLD key → its new key. Read-time only
 * (sanitizeEquipmentMap): an Equipment map entry stored under the old key
 * reads as the new row until the blob holds the new key at all (saved, or
 * cleared as null) — then the old entry is ignored. Nothing is rewritten.
 *
 * D393: empty — controls:outputStation → lighting:cablePackage was removed.
 * Cable Package is now counted per cable (fixtures × per fixture × tier), so
 * an old Output-station part mapping must NOT carry over and misprice it; a
 * stored controls:outputStation row is simply unknown now and dropped
 * (sanitizeEquipmentMap's own EQUIPMENT_ROW_BY_KEY check), leaving Cable
 * Package unmapped. Left exported (empty) as the seam for a future row move.
 */
export const EQUIPMENT_KEY_ALIASES: ReadonlyMap<string, string> = new Map();

/**
 * #233 — Quick Design qty overrides are keyed system → item NAME (D324), so a
 * relabel would orphan them. Old "system:label" → new "system:label", applied
 * where a saved config is read (cleanQtyOverrides, quick/engine.ts), which is
 * the screen's and the server's one read path. The next save writes the new
 * names; no stored record is rewritten.
 *
 * One hop only: each old label maps straight to its CURRENT label, and the
 * lookup is applied once — never chained. A future relabel of a target here
 * must update every entry pointing at it (and add the old target as a key).
 *
 * D393: no "controls:Output station" → "lighting:Cable Package" entry — a
 * typed Output-station qty must NOT carry to Cable Package (it's counted per
 * cable now, not by the old row's math). cleanQtyOverrides falls through to
 * its unaliased branch for that key, so an old override just sits inertly
 * under controls (no live row reads it) instead of mispricing the new one.
 */
export const EQUIPMENT_LABEL_ALIASES: ReadonlyMap<string, string> = new Map([
  ["rigging:Aircraft cable", "rigging:Suspension Method"],
  ["rigging:Chain wrap, 3 ft", "rigging:Batten Termination"],
  ["rigging:Termination kit", "rigging:Beginning Termination"],
  ["controls:Console touch screen", "controls:Console Accessories"],
  ["controls:Battery backup", "controls:Emergency"],
  ["controls:Processor", "controls:Power Controls – Production"],
  ["controls:Button", "controls:Power Controls – Architectural"],
  ["controls:Architectural touch screen", "controls:Architectural Controls"],
  ["controls:Input station", "controls:DMX Distribution"],
  ["controls:Distro system", "controls:Labor"],
]);
