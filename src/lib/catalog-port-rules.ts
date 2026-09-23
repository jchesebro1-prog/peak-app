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
 *
 * Every `note` below states what its regex ACTUALLY does, measured against the
 * live 14,725-part catalog. A note that flatters a rule is worse than no note:
 * it is the only thing a human reads before approving thousands of rows.
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

/* ------------------------------------------------------------------ */
/* Shared vocabulary                                                    */
/* ------------------------------------------------------------------ */

/**
 * The nouns that make a line item a physical accessory rather than a device.
 * One constant, used both to FIND an accessory and to decide (below) that a
 * device noun is merely the accessory's target — two drifting copies would
 * make the accessory layer's exclude quietly disagree with its own match.
 */
const ACCESSORY_NOUN =
  "(?:cover|bracket|mount(?:ing)?|rack ?ear|bag|case|cord|cable|adapter plate|barndoor|barn door|gel frame|clamp|yoke|spare|pole|stand|grille|grill|filter|lamp|bulb|screw|washer|blank|carry|pouch|strap|wheel|caster|handle|dust|lens tube)s?";

/**
 * Device nouns — the head noun of a real piece of hardware.
 *
 * `microphone`/`mic` is deliberately absent: no microphone shape exists, so a
 * mic classed as an accessory and a mic left unmatched both end up with no
 * ports, while genuine mic accessories ("MIC STAND ADAPTER FOR MXA710") do
 * need to stay accessories.
 */
const DEVICE_NOUN =
  "(?:loud)?speakers?|subwoofers?|amplifiers?|cameras?|mixers?|receivers?|transmitters?|extenders?|dsps?|processors?|fixtures?|monitors?|columns?|cabinets?|arrays?|switchers?|matri(?:x|ces)|consoles?|systems?";

/**
 * The words with which a listing stops describing ITSELF and starts naming
 * what it ships with, works with, or is for: "Amplifier **with** Dante;
 * includes rack mount", "Cluster Bracket **for** P4228", "Extender Kit
 * **over** Category Cable".
 */
const BUNDLING = "(?:\\b(?:includes?|including|included|with|for|over|plus|featur\\w+)\\b|w\\/)";

/**
 * A device noun that is the PRIMARY subject of the description: it appears
 * before the first bundling word, and is not itself immediately qualified by
 * an accessory noun ("Camera Mount", "STRIKE Array Flush Bracket") within the
 * same head phrase.
 *
 * `(?<![-\w])` keeps "pre-amplifier" (a mic-preamp feature on a Q-SYS card)
 * from reading as "amplifier".
 */
const PRIMARY_DEVICE = new RegExp(
  `^(?:(?!${BUNDLING})[\\s\\S])*?(?<![-\\w])(?:${DEVICE_NOUN})\\b` +
    `(?!(?:(?!${BUNDLING})[\\s\\S]){0,12}?\\b${ACCESSORY_NOUN}\\b)`,
  "i"
);

/**
 * Power-amp spec lines, for the amplifiers whose descriptions never use the
 * word: QSC's "8 channels, 100 watts/ch at 70V." and LEA's "4CH x 350W".
 * The device drives the line; it is not a box hanging off one. Spelled-out
 * "watts" on purpose in the first form — QSC's isolation-transformer panel
 * says "400 w/ch" and is not an amplifier.
 */
const POWER_AMP_SPEC =
  "\\b\\d{1,2}\\s*channels?,\\s*\\d+\\s*watts?\\s*\\/\\s*ch\\b|\\b\\d{1,2}\\s*ch\\b\\s*[x\u00d7]\\s*\\d+\\s*w\\b";

/** Word-form channel counts the catalog actually uses. */
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, sixteen: 16, twentyfour: 24,
  thirtytwo: 32,
};

/**
 * "4 Channel amplifier" -> 4, "Sixteen Channel ... Amplifier" -> 16.
 * Falls back when the description says nothing.
 *
 * The leading/trailing `\b` on the digits matter: without them "128 Channel"
 * read as 28, silently proposing a 28-output amplifier.
 */
export function channelCount(desc: string, fallback: number): number {
  const text = desc || "";
  const digits = /\b(\d{1,2})\b\s*[-\s]?(?:channels?|ch)\b/i.exec(text);
  if (digits) {
    const n = Number(digits[1]);
    if (Number.isInteger(n) && n >= 1 && n <= 64) return n;
  }
  const word = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|sixteen|twenty[-\s]?four|thirty[-\s]?two)[-\s]?channels?\b/i.exec(text);
  if (word) {
    const n = NUMBER_WORDS[word[1].toLowerCase().replace(/[-\s]/g, "")];
    if (n) return n;
  }
  return fallback;
}

/**
 * "8x8 matrix" / "1x4 splitter" / "8 HDMI input, 8 HDMI output" -> the
 * requested side.
 *
 * The inch guard is the point: `2 x 15" Subwoofer` and `4 x 12" LF` are driver
 * complements, not port counts, and an NxM read off them would propose a
 * 2-in/15-out device.
 */
export function portCount(desc: string, side: "in" | "out", fallback: number): number {
  const text = desc || "";
  const ok = (v: string) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 64 ? n : null;
  };
  const nx = /\b(\d{1,2})\s*[x×]\s*(\d{1,2})\b(?!\s*(?:["'“”′″]|-?\s*inch|in\b|mm\b|cm\b|ft\b|feet\b|m\b|w\b|watts?\b|ohms?\b))/i.exec(text);
  if (nx) {
    const n = ok(side === "in" ? nx[1] : nx[2]);
    if (n !== null) return n;
  }
  const io = /\b(\d{1,2})\b[^,;.]{0,24}?\binputs?\b[\s\S]{0,40}?\b(\d{1,2})\b[^,;.]{0,24}?\boutputs?\b/i.exec(text);
  if (io) {
    const n = ok(side === "in" ? io[1] : io[2]);
    if (n !== null) return n;
  }
  return fallback;
}

/**
 * The rule set (#159 Task 3, D198; corrected D199). Order encodes priority —
 * first match wins — and every pattern below was measured against the live
 * catalog, not reasoned about in the abstract. Where the measurement
 * disagreed with the pattern, the pattern changed; see
 * .superpowers/sdd/rule-fix-report.md for the before/after counts.
 */
export const PORT_RULES: readonly PortRule[] = [
  /* ---- accessory layer: FIRST, always (D195) ----
     Without this layer a "Horizontal Bracket for MR50" falls through to a
     speaker rule and is given speaker ports. A match here is a deliberate
     success, not a miss.

     The hard part is the opposite failure: nearly every real device lists its
     own bundled hardware ("Amplifier; includes rack mount", "PTZ Network
     Camera ... Includes PTZ-WMB1 wall mount bracket", "Four--channel
     receiver. Includes ... cables"), and a bare keyword layer swallowed ~45 of
     them — worse than a wrong shape, because a swallowed device is reported as
     a deliberate accessory instead of as a coverage gap.

     So the exclude asks whether the description is PRIMARILY about a device:
     a device noun before the first "with/includes/for/over", not itself
     qualified by a trailing accessory noun. That second clause is what keeps
     "Cluster Bracket for ... Speakers", "Caster Wheel for Subwoofer",
     "Huddley Camera Mount" and "STRIKE Array Flush Bracket" in the accessory
     bucket where they belong. */
  {
    id: "accessory",
    desc: new RegExp(`\\b${ACCESSORY_NOUN}\\b`, "i"),
    exclude: PRIMARY_DEVICE,
    accessory: true,
    shape: () => [],
    note: "Physical accessories have no electrical ports. Ordered first so a device rule can never claim a bracket. Claims a part only when the description is PRIMARILY about the accessory: if a device noun (speaker, amplifier, camera, mixer, receiver, extender, DSP, fixture, array, cabinet, system…) appears before the first bundling word (with / includes / for / over) and is not itself qualified by a trailing accessory noun, the part is a device and falls through to its real rule. That is why \"Four Channel ... DSP Amplifier with Dante; includes rack mount\" is an amplifier while \"Huddley Camera Mount for 40\\\" Monitors\" and \"STRIKE Array Flush Bracket\" stay accessories.",
  },

  /* ---- speakers ----
     70V is checked BEFORE plain "passive": ~42 real EAW/RCF SKUs are BOTH
     passive AND 70V/100V-transformer-tapped ("Passive 160W 5\" Wall Mount
     Monitor Speaker w/ Transformer - 8 Ω, 70/100V"). Passive-first silently
     gave every one of them a speakON NL2 input when they take a 70V pair. */
  {
    id: "speaker-70v",
    desc: /\b(70 ?v|100 ?v|constant voltage|transformer|trafo)\b/i,
    exclude: new RegExp(
      `(?<![-\\w])amplifiers?\\b|\\bpower ?amps?\\b|${POWER_AMP_SPEC}` +
        `|\\b(?:mixers?|dsps?|processors?|isolation|panels?|kits?|balanced)\\b` +
        `|\\bno transformer\\b`,
      "i"
    ),
    shape: () => seventyVSpeakerPorts(),
    note: "70V/100V distributed lines take a transformer-tapped pair, not speakON. Checked before speaker-passive because most RCF/EAW 70V commercial speakers ALSO say \"Passive\". Excludes anything that DRIVES the line rather than hanging off it: the word amplifier, \"power amp\", and QSC's bare power-amp spec form (\"8 channels, 100 watts/ch at 70V.\" — 9 QSC CX/ISA amplifiers were being given a 70V speaker INPUT because they never use the word amplifier). Also excludes the \"16Ω (no transformer)\" negation, and mixer/DSP/isolation-transformer/kit language.",
  },
  {
    id: "speaker-passive",
    desc: /\bpassive\b/i,
    exclude: /(?<![-\w])amplifiers?\b|\b(?:dsps?|processors?|antennas?)\b/i,
    shape: () => passiveSpeakerPorts(),
    note: "A passive box with no 70V/transformer tap has no amplifier and no power inlet — a single speakON NL2 input is the install standard. The exclude does NOT contain the bare token \"amp\": 61 EAW/QSC/Fulcrum passive speakers say \"Bi-Amp\", \"Tri-amp\" or \"requires (2) amp channels\", and evicting them handed every one to the amplifier rule, which wired them as amplifiers with four speakON NL4 OUTPUTS. A passive speaker that mentions bi-amping is still a passive speaker. Nothing in the live catalog says both \"passive\" and \"amplifier\", so the remaining terms are guards, not workers. \"Antenna\" excludes Shure's passive RF antennas.",
  },
  {
    id: "speaker-powered",
    desc: /\b(powered|active|self-?powered)\b.*\b((?:loud)?speakers?|monitors?|subwoofers?|subs?|arrays?|columns?)\b|\b((?:loud)?speakers?|monitors?|subwoofers?|subs?|arrays?|columns?)\b.*\b(powered|active)\b/i,
    exclude: /\bpoe\b/i,
    shape: () => poweredSpeakerPorts(),
    note: "A powered box carries its own amp: line input plus a mains inlet. Matches \"loudspeaker\" as well as \"speaker\" — QSC/EAW/Shure write \"Powered Loudspeaker\" as one word in 44 real SKUs, and a bare \\bspeaker\\b regex never matches inside that word. Excludes PoE-powered boxes: QSC's \"network loudspeaker, PoE/PoE+ powered\" has no mains inlet at all, and no PoE shape exists to give it, so it is reported as a gap rather than given a powerCON it does not have.",
  },

  /* ---- amplifiers — new shape, D197 ---- */
  {
    id: "amplifier",
    desc: new RegExp(`(?<![-\\w])amplifiers?\\b|\\bpower ?amps?\\b|${POWER_AMP_SPEC}`, "i"),
    exclude: /\b(brackets?|covers?|cards?|modules?|accessor(?:y|ies))\b|\bdistribution amplifiers?\b/i,
    shape: (part) => amplifierPorts(channelCount(part.desc, 4)),
    note: "Install amps take line in, speaker-level out, and a control network. Requires the whole word \"amplifier\" (or \"power amp\", or QSC's \"N channels, N watts/ch\" spec line) — NEVER the bare token \"amp\", which matched \"Bi-Amp\", \"requires (2) amp channels\", \"1 Amp Power Supply\" and \"5 amp contacts\" and wired 61 passive speakers, a power supply and two relays as amplifiers. \"pre-amplifier\" is excluded by lookbehind (a mic-preamp feature on a Q-SYS card is not an amplifier). \"Distribution amplifier\" is an HDMI splitter and is handed to av-splitter below. Channel count is read from the description — digits or number words — defaulting to 4.",
  },

  /* ---- wireless mic systems — new shape, D197 ---- */
  {
    id: "wireless-receiver",
    desc: /\breceiver\b/i,
    category: /Audio/i,
    exclude: /\b(brackets?|covers?|kit bags?|rack hardware)\b|^[^.]*\bantennas?\b/i,
    shape: (part) => wirelessReceiverPorts(channelCount(part.desc, 1)),
    note: "A wireless receiver's audio output is what gets wired; antennas are RF and deliberately not modelled. Restricted to category Audio: AVPro Edge (category AV Distribution) uses \"receiver\" for HDBaseT extender halves, which is a different device with its own rule below. The antenna exclude is anchored to the FIRST sentence — a genuine antenna product leads with it, whereas Shure's AD4Q rack receivers merely list \"coaxial antenna\" among the cables in the box, and excluding on the bare word lost 20 real receivers.",
  },

  /* ---- DSP — new shape, D197 ---- */
  {
    id: "dsp",
    desc: /\b(dsps?|processors?)\b/i,
    category: /Audio/i,
    exclude: /\b(cards?|modules?|expanders?|brackets?|licenses?|software|scripting engine|deployment)\b/i,
    shape: (part) => dspPorts(channelCount(part.desc, 8), channelCount(part.desc, 8)),
    note: "Fixed-architecture DSP: analog in/out plus the audio network, sized from the description's channel count where it states one (\"Access Point/Charger/DSP - 2 Ch.\" gets 2x2, not a hardcoded 8x8) and 8x8 — the common install size — where it does not. This rule is broad by construction: it keys on the words \"DSP\" and \"processor\" inside category Audio, which is also how amplifier modules with onboard DSP describe themselves, so the rule ordering above it (amplifier first) is doing real work. The \"tesira\" and \"q-sys core\" branches the draft carried were removed: Biamp is out of scope so tesira could never fire, and every \"Q-SYS Core\" row in the catalog is a software licence that the exclude already removes. Restricted to category Audio because AVPro Edge's AV Distribution catalog uses \"processor\" for video-wall scalers and IR/RF control processors.",
  },

  /* ---- AV distribution — restricted to category AV Distribution so a Shure
     mic's "Internal Matrix" or "Wireless Microphone Flag Extender Kit" can
     never be read as HDMI gear. ---- */
  {
    id: "av-matrix",
    desc: /^(?=[\s\S]*\bmatrix\b)(?=[\s\S]*\b(?:hdmi|hdbaset|hdbt|sdi|displayport|dvi|video)\b)/i,
    category: /AV Distribution/i,
    exclude: /\bnot for use\b|\b(?:en|de)coders?\b|\bmultiviewer\b/i,
    shape: (part) => matrixPorts(portCount(part.desc, "in", 4), portCount(part.desc, "out", 4)),
    note: "An HDMI/HDBaseT matrix. Requires BOTH the word \"matrix\" and a video token (HDMI/HDBaseT/SDI/DisplayPort/DVI/video): a bare \\bmatrix\\b claimed AVPro Edge's \"Audio Distribution 16x16 DSP Matrix\" and \"24 port 2 channel audio matrix\" and gave them HDMI ports. Excludes negations (\"**not** for use as a transmitter or receiver for any matrix switch\" is a wall-plate extender kit, and this rule was stealing it from av-extender) and AV-over-IP encoders/decoders, which say \"switch matrix routable\" but are endpoints with no matrix I/O — they are left unmatched rather than given a matrix's shape. Counts come from an NxM or from \"N ... input ... N ... output\" prose, defaulting to 4x4.",
  },
  {
    id: "av-extender",
    desc: /^(?=[\s\S]*\b(?:extender|extension kit)s?\b)(?=[\s\S]*\b(?:hdmi|hdbaset|hdbt|4k|8k|1080p|uhd|video)\b)/i,
    category: /AV Distribution/i,
    exclude: /\b(?:receiver|transmitter|audio)[\s-]*only\b|\bpower suppl(?:y|ies)\b|\bzigbee\b|\bwireless\b|\bfiber\b|\bfibre\b|\bfiber optics?\b/i,
    shape: () => extenderKitPorts(),
    note: "An HDMI/HDBaseT extender KIT: one HDMI input at the transmitter and one HDBaseT run to the receiver. Now requires a video token alongside the word \"extender\", which was the greediest pattern in the set — it claimed \"Power Supply for VIP-UHD-TX/RX\", \"Wireless Zigbee range extender\", \"USB 2.0 Point to Point Extender Kit\", \"2Ch Audio Extender\" and \"Power 8 Extenders with 1 Power supply\", none of which carry HDMI. The \"tx/rx\" branch is gone; it only ever matched a power supply. Receive-only and transmit-only halves are excluded and left UNMATCHED on purpose: this shape bundles TX and RX, so applying it to an RX unit inverts BOTH directions, and no one-ended shape exists to invent. Fibre kits are excluded for the same reason — their run is fiber, not HDBaseT (Cat6a), and there is no fibre extender shape.",
  },
  {
    id: "av-splitter",
    desc: /\b(splitter|distribution amplifiers?)\b/i,
    category: /AV (?:Distribution|Infrastructure)/i,
    shape: (part) => splitterPorts(portCount(part.desc, "out", 4)),
    note: "A splitter takes one HDMI in and fans out; the output count is read from the description. The \"distribution amplifier\" branch is live again: it was dead code while the amplifier rule ran first and claimed all 7 HDMI DA rows, so that rule now excludes the phrase and they land here. Category widened to AV Infrastructure as well as AV Distribution, which is where FSR files its two HDMI DAs. Restricted to those categories because Shure sells RF \"Antenna Splitter/Combiner\" kits under category Audio that say \"splitter\" but are not HDMI hardware.",
  },

  /* ---- cameras ---- */
  {
    id: "camera-ptz",
    desc: /\b(ptz|camera)\b/i,
    exclude: /\b(adapt(?:o|e)rs?|keyboards?|junction box|drawers?|warrant(?:y|ies)|software|bundles?|room kits?|touch displays?|(?:en|de)coders?|controllers?)\b/i,
    shape: (part) => ptzCameraPorts(/\bsdi\b/i.test(part.desc) ? "SDI/BNC" : "HDMI"),
    note: "A PTZ camera's wired output is SDI when the description says so, otherwise HDMI. The rule matches any \"PTZ\"/\"camera\" row in any category, so its exclude is where the work happens: BirdDog's catalog files extended-warranty line items, a software product, an NDI encoder, a PTZ keyboard controller, an RJ45 adaptor, a junction box and multi-camera promo bundles all under the same words, and none of them is a camera with one video output; a Shure \"IMX Room Kit, Large, Multi Camera\" is a whole conferencing bundle and is excluded too. It deliberately does NOT exclude \"bracket\", \"cover\" or \"mount\": real cameras bundle their own mount (\"Includes PTZ-WMB1 wall mount bracket\") and the old bracket exclude rejected every one of QSC's PTZ cameras. Pure camera mounting hardware is decided by the accessory layer above, on where the noun sits rather than on whether the word appears.",
  },

  /* ---- lighting fixtures ---- */
  {
    id: "fixture-led",
    desc: /\b(led|colordash|colorado|ovation|rogue|maverick)\b/i,
    mfr: "Chauvet Professional",
    category: /^(?!.*\baccessor)/i,
    exclude: /\b(brackets?|barndoors?|lens(?:es)?|gels?|accessor(?:y|ies)|covers?|cases?|iris|gobo|strips?|video panels?)\b/i,
    shape: () => ledFixturePorts(),
    note: "An LED fixture is DMX in, DMX thru, and a powerCON mains inlet. Scoped to mfr Chauvet Professional — the only lighting brand in scope; without it, every Shure gooseneck mic that mentions its own status \"LED\" was read as a DMX fixture. The category guard is a negative pattern on purpose: `exclude` is only ever tested against the DESCRIPTION, so Chauvet's \"Ovation Series Accessories\" rows (\"Drop-in Iris\", \"Gobo Rotator\", \"Stealth Dome\") were getting DMX and powerCON no matter what words the exclude listed. LED strips and SMD video panels are excluded too: they are fed by their own drive unit or a video processor, not by DMX + powerCON, and neither has a shape here.",
  },

  /* ---- mixers ---- */
  {
    id: "mixer",
    desc: /\b(mixer|mixing console)\b/i,
    exclude: /\b(brackets?|covers?|bags?|controllers?|mixer channels?)\b/i,
    shape: () => mixerAllInOnePorts(),
    note: "An all-in-one mixer: XLR in and out plus the audio network. Excludes \"controller\" — QSC's Decora-style wall controller for \"MP-M zone mixers\" merely refers to a mixer elsewhere in the system and is not one itself — and \"mixer channels\", which is how a Shure gooseneck mic says what it plugs INTO (\"requires two mixer channels\"). RCF's 70V \"Mixer/Amplifier\" products are already claimed by the amplifier rule above, which runs first; Shure's \"Eight-Channel Automatic Mixer ... Rack Mount Ready\" and Allen & Heath's rack-mount mixers reach this rule only because the accessory layer no longer swallows a device for describing its own rack mounting.",
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
