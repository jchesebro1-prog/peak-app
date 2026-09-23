import { type Port } from "@/lib/catalog-connect";
import {
  passiveSpeakerPorts, seventyVSpeakerPorts, poweredSpeakerPorts, amplifierPorts,
  wirelessReceiverPorts, dspPorts, matrixPorts, extenderKitPorts, splitterPorts,
  ptzCameraPorts, ledFixturePorts, mixerAllInOnePorts,
} from "@/lib/catalog-port-shapes";

/**
 * Port rules (#159, D193) — an ordered list matched first-wins against a
 * catalog part to decide WHICH port shape applies.
 *
 * The list is the reviewable artifact: Jeff approves, edits or rejects a RULE,
 * and that verdict covers every part it matched. Review effort therefore
 * scales with rules (~30) rather than parts (thousands), and a rule is
 * checkable from experience in a way an individual row is not.
 *
 * First match wins, deliberately. A scored best-match would make "why did this
 * part get these ports?" unanswerable, and answering that is the entire point
 * of reviewing rules.
 */

/** The part fields a rule may look at. Deliberately narrow. */
export type RulePart = { sku: string; desc: string; category: string; mfr?: string };

export type PortRule = {
  /** Stable id — this is what gets named in `--rules` to approve it. */
  id: string;
  /** Exact manufacturer, when the rule is brand-specific. */
  mfr?: string;
  category?: RegExp;
  desc: RegExp;
  /** Description patterns this rule must NOT match. */
  exclude?: RegExp;
  shape: (part: RulePart) => Port[];
  /** Match means "no ports, deliberately" — an accessory, not a miss (D195). */
  accessory?: true;
  /** Why this rule is correct. Read during review; keep it a real reason. */
  note: string;
};

/** "4 Channel amplifier" -> 4. Falls back when the description says nothing. */
function channelCount(desc: string, fallback: number): number {
  const m = /(\d{1,2})\s*[-\s]?(?:channel|ch\b)/i.exec(desc || "");
  const n = m ? Number(m[1]) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 64 ? n : fallback;
}

/** "8x8 matrix" / "1x4 splitter" -> the requested side. */
function portCount(desc: string, side: "in" | "out", fallback: number): number {
  const m = /(\d{1,2})\s*[x×]\s*(\d{1,2})/i.exec(desc || "");
  if (!m) return fallback;
  const n = Number(side === "in" ? m[1] : m[2]);
  return Number.isInteger(n) && n >= 1 && n <= 64 ? n : fallback;
}

/**
 * The rule set (#159 Task 3, D198). Order encodes priority — first match
 * wins — and every pattern below was checked against real descriptions
 * dumped from the live catalog (EAW/RCF/QSC/Shure/AVPro Edge/Chauvet
 * Professional), not just the sampled draft. Where the real data disagreed
 * with the starting draft, the pattern was changed; see
 * .superpowers/sdd/task-3-report.md for every one of those changes with the
 * real description that forced it.
 */
export const PORT_RULES: readonly PortRule[] = [
  /* ---- accessory layer: FIRST, always (D195) ----
     907 of 5,657 in-scope parts are accessories. Without this layer a
     "Horizontal Bracket for MR50" falls through to a speaker rule and is given
     speaker ports. A match here is a deliberate success, not a miss.

     The trailing `s?` on every alternative is real: "Rain Covers", "Rack
     Hardware"-style plurals like "Amplifiers" and "Brackets" are how the
     catalog actually writes these, and a bare singular regex silently missed
     them. The exclude guards the opposite failure — QSC/EAW writes a
     speaker's OWN bundled mounting hardware straight into its listing
     ("includes yoke mount", "blind mount installation", "Wall Mount Cabinet"),
     and without this exclude ~100 real QSC ceiling/surface speakers were
     silently swallowed here and given no ports at all instead of their real
     70V or passive shape. */
  {
    id: "accessory",
    desc: /\b(cover|bracket|mount(ing)?|rack ?ear|bag|case|cord|cable|adapter plate|barndoor|barn door|gel frame|clamp|yoke|spare|pole|stand|grille|grill|filter|lamp|bulb|screw|washer|blank|carry|pouch|strap|wheel|caster|handle|dust|lens tube)s?\b/i,
    exclude: /\b((?:loud)?speakers?|subwoofers?|monitors?|columns?|arrays?|cabinets?)\b/i,
    accessory: true,
    shape: () => [],
    note: "Physical accessories have no electrical ports. Ordered first so a device rule can never claim a bracket. Excludes speaker/subwoofer/monitor/column/array/cabinet nouns so a device describing its own bundled mount or cable is not swallowed here instead of getting its real shape.",
  },

  /* ---- speakers (658 in-scope parts) ----
     70V is checked BEFORE plain "passive": the draft had these in the
     opposite order, and ~42 real EAW/RCF SKUs are BOTH passive AND
     70V/100V-transformer-tapped ("Passive 160W 5" Wall Mount Monitor Speaker
     w/ Transformer - 8 Ω, 70/100V"). Passive-first silently gave every one of
     them a speakON NL2 input when they actually take a 70V pair. Specific
     wins over general, same principle as the accessory layer going first. */
  {
    id: "speaker-70v",
    desc: /\b(70 ?v|100 ?v|constant voltage|transformer|trafo)\b/i,
    exclude: /\b(amplifiers?|amps?|mixers?|dsp|processors?|isolation|panels?|kits?|balanced)\b/i,
    shape: () => seventyVSpeakerPorts(),
    note: "70V/100V distributed lines take a transformer-tapped pair, not speakON. Checked before speaker-passive because most RCF/EAW 70V commercial speakers ALSO say \"Passive\". Excludes amplifier/mixer/DSP/isolation-transformer/kit language — RCF sells 70V-CAPABLE power amps and mixer-amps (\"Class D Power Amplifier ... 70/100V\") and QSC sells isolation-transformer accessories that would otherwise be misread as a 70V speaker input.",
  },
  {
    id: "speaker-passive",
    desc: /\bpassive\b/i,
    exclude: /\b(amplifiers?|amps?|dsps?|processors?)\b/i,
    shape: () => passiveSpeakerPorts(),
    note: "A passive box with no 70V/transformer tap has no amplifier and no power inlet — a single speakON NL2 input is the install standard.",
  },
  {
    id: "speaker-powered",
    desc: /\b(powered|active|self-?powered)\b.*\b((?:loud)?speakers?|monitors?|subwoofers?|subs?|arrays?|columns?)\b|\b((?:loud)?speakers?|monitors?|subwoofers?|subs?|arrays?|columns?)\b.*\b(powered|active)\b/i,
    shape: () => poweredSpeakerPorts(),
    note: "A powered box carries its own amp: line input plus a mains inlet. Matches \"loudspeaker\" as well as \"speaker\" — QSC/EAW/Shure write \"Powered Loudspeaker\" as one word in 44 real SKUs, and a bare \\bspeaker\\b regex never matches inside that word, missing all of them.",
  },

  /* ---- amplifiers (97) — new shape, D197 ---- */
  {
    id: "amplifier",
    desc: /\bamp(lifiers?)?\b/i,
    exclude: /\b(brackets?|covers?|cards?|modules?|accessor(?:y|ies))\b/i,
    shape: (part) => amplifierPorts(channelCount(part.desc, 4)),
    note: "Install amps take line in, speaker-level out, and a control network. Channel count is read from the description, defaulting to 4. Matches plural \"Amplifiers\" too (the bare-singular draft pattern missed RCF's own category name and several real descriptions). Ordered before the DSP and AV-matrix rules so \"Class D Digital Matrix Amplifier\" and \"power amplifier with DSP\" land here, not on a device class they only superficially resemble.",
  },

  /* ---- wireless mic systems (267) — new shape, D197 ---- */
  {
    id: "wireless-receiver",
    desc: /\breceiver\b/i,
    category: /Audio/i,
    exclude: /\b(brackets?|antennas?|covers?|kit bags?|rack hardware)\b/i,
    shape: (part) => wirelessReceiverPorts(channelCount(part.desc, 1)),
    note: "A wireless receiver's audio output is what gets wired; antennas are RF and deliberately not modelled. Restricted to category Audio: AVPro Edge (category AV Distribution) uses \"receiver\" for HDBaseT extender halves and distribution amps, which is a different device entirely and has its own rule below. Excludes antenna/rack-hardware accessories that merely reference a Shure receiver model by name.",
  },

  /* ---- DSP (27) — new shape, D197 ---- */
  {
    id: "dsp",
    desc: /\b(dsp|processors?|tesira|q-?sys core)\b/i,
    category: /Audio/i,
    exclude: /\b(cards?|modules?|expanders?|brackets?|licenses?|software|scripting engine|deployment)\b/i,
    shape: () => dspPorts(8, 8),
    note: "Fixed-architecture DSP: analog in/out plus the audio network. 8x8 is the common install size; a specific model that differs gets corrected in the editor. Restricted to category Audio and excludes license/software text: AVPro Edge's \"AV Distribution\" catalog uses \"processor\" for video-wall scalers, eARC processors and IR/RF remote-control processors — none of them an XLR analog DSP — and QSC sells bare \"Q-SYS Core ... Software License\" SKUs under category Audio that are not physical devices at all.",
  },

  /* ---- AV distribution (78) — restricted to category AV Distribution so a
     Shure mic's "M-S Stereo Microphone with Internal Matrix" or "Wireless
     Microphone Flag Extender Kit" can never be read as HDMI gear. ---- */
  {
    id: "av-matrix",
    desc: /\bmatrix\b/i,
    category: /AV Distribution/i,
    shape: (part) => matrixPorts(portCount(part.desc, "in", 4), portCount(part.desc, "out", 4)),
    note: "An HDMI/HDBaseT matrix: input and output counts are read from an NxM in the description, defaulting to 4x4. Restricted to category AV Distribution — RCF's \"Digital Matrix Amplifiers\" and Shure's \"Internal Matrix\" stereo mic both say \"matrix\" but are audio devices the amplifier rule (or nothing) should claim, not this one.",
  },
  {
    id: "av-extender",
    desc: /\b(extender|extension kit|tx\/rx)\b/i,
    category: /AV Distribution/i,
    shape: () => extenderKitPorts(),
    note: "An extender kit is one HDMI input at the transmitter and one HDBaseT run to the receiver. Restricted to category AV Distribution so Shure's \"Wireless Microphone Flag Extender Kit\" (a cosmetic mic-flag accessory) is never read as HDMI gear.",
  },
  {
    id: "av-splitter",
    desc: /\b(splitter|distribution amplifier)\b/i,
    category: /AV Distribution/i,
    shape: (part) => splitterPorts(portCount(part.desc, "out", 4)),
    note: "A splitter takes one HDMI in and fans out; the output count is read from the description. Restricted to category AV Distribution — Shure sells RF \"Antenna Splitter/Combiner\" kits for wireless mic systems under category Audio that say \"splitter\" but are not HDMI hardware.",
  },

  /* ---- cameras (2) ---- */
  {
    id: "camera-ptz",
    desc: /\b(ptz|camera)\b/i,
    exclude: /\b(brackets?|covers?)\b/i,
    shape: (part) => ptzCameraPorts(/\bsdi\b/i.test(part.desc) ? "SDI/BNC" : "HDMI"),
    note: "A PTZ camera's wired output is SDI when the description says so, otherwise HDMI. Does not exclude \"mount\" — nearly every real camera SKU bundles its own mounting bracket in the same listing, so excluding on that word would exclude almost every camera; a pure mounting-bracket accessory is caught by the accessory layer above instead.",
  },

  /* ---- lighting fixtures (23) ---- */
  {
    id: "fixture-led",
    desc: /\b(led|colordash|colorado|ovation|rogue|maverick)\b/i,
    mfr: "Chauvet Professional",
    exclude: /\b(brackets?|barndoors?|lens(?:es)?|gels?|accessor(?:y|ies)|covers?|cases?)\b/i,
    shape: () => ledFixturePorts(),
    note: "An LED fixture is DMX in, DMX thru, and a powerCON mains inlet. Scoped to mfr Chauvet Professional — the only lighting brand in scope. Without that scope, every Shure gooseneck mic that mentions its own status \"LED\" or \"LED Indicator\" (a common phrase in that catalog) was misread as a DMX lighting fixture.",
  },

  /* ---- mixers (18) ---- */
  {
    id: "mixer",
    desc: /\b(mixer|mixing console)\b/i,
    exclude: /\b(brackets?|covers?|bags?|controllers?)\b/i,
    shape: () => mixerAllInOnePorts(),
    note: "An all-in-one mixer: XLR in and out plus the audio network. Excludes \"controller\" — QSC's Decora-style wall controller for \"MP-M zone mixers\" merely refers to a mixer elsewhere in the system and is not one itself. RCF's 70V \"Mixer/Amplifier\" products are already claimed by the amplifier rule above, which runs first.",
  },
];

export function matchRule(
  part: RulePart,
  rules: readonly PortRule[] = PORT_RULES
): PortRule | null {
  for (const rule of rules) {
    if (rule.mfr && rule.mfr !== (part.mfr || "")) continue;
    if (rule.category && !rule.category.test(part.category || "")) continue;
    if (!rule.desc.test(part.desc || "")) continue;
    if (rule.exclude && rule.exclude.test(part.desc || "")) continue;
    return rule;
  }
  return null;
}

/**
 * The ports a rule proposes for a part, or null when nothing applies.
 *
 * An ACCESSORY match also returns null — it has no ports by definition. That
 * is a success, not a miss, and the two must not be conflated in the report or
 * 907 correctly-ignored brackets would hide the real coverage gaps (D195).
 * Callers that need the distinction use matchRule() and check `.accessory`.
 */
export function proposeForPart(
  part: RulePart,
  rules: readonly PortRule[] = PORT_RULES
): { rule: PortRule; ports: Port[] } | null {
  const rule = matchRule(part, rules);
  if (!rule || rule.accessory) return null;
  return { rule, ports: rule.shape(part) };
}
