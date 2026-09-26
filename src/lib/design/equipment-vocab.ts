/**
 * The equation item vocabulary (#211, D301). Every item compute()
 * (quick/engine.ts) can emit, keyed `system:itemKey` — stable keys, never
 * display text. The Equipment map, the Auto intake and saved overrides all key
 * on these, so a relabel never orphans a mapping. `label` is the equation's
 * own item name (asserted equal by the #211 T1 spec block). Pure and
 * dollar-free: client components may import it.
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
  row("rigging", "aircraftCable", "Aircraft cable", "ft", "lot", ["aircraft cable", "wire rope"]),
  row("rigging", "chainWrap", "Chain wrap, 3 ft", "ea", "lot", ["chain"]),
  row("rigging", "terminationKit", "Termination kit", "ea", "lot", ["termination", "swage", "thimble"]),
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
  // Controls (Quick Design only)
  row("controls", "console", "Console", "ea", "none", ["console"]),
  row("controls", "consoleTouch", "Console touch screen", "ea", "none", ["touch", "monitor"]),
  row("controls", "batteryBackup", "Battery backup", "ea", "none", ["ups", "battery"]),
  row("controls", "processor", "Processor", "ea", "none", ["processor", "architectural"]),
  row("controls", "button", "Button", "ea", "none", ["button", "station"]),
  row("controls", "archTouch", "Architectural touch screen", "ea", "none", ["touch"]),
  row("controls", "inputStation", "Input station", "ea", "none", ["input", "node"]),
  row("controls", "outputStation", "Output station", "ea", "none", ["output", "node"]),
  row("controls", "distro", "Distro system", "ea", "none", ["distro", "switch", "gateway"]),
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
];

export const EQUIPMENT_ROW_BY_KEY: ReadonlyMap<string, EquipRowDef> = new Map(EQUIPMENT_ROWS.map((r) => [r.key, r]));

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
