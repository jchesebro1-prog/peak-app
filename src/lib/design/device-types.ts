/* ------------------------------------------------------------------ *
 * The Grid — curated device types (#226, spec 2026-09-26).
 *
 * CatalogPart.category is free text copied from ~52 vendor sheets; the
 * Grid stopped being usable once every surface listed those raw strings.
 * A DEVICE TYPE is the Grid's own ~25-row vocabulary: each raw category
 * maps (through the `gridTypeMap` blob — auto-applied when the match is
 * confident, admin-confirmed otherwise) to at most one type, and a type
 * carries the Grid scope. Nothing here rewrites a catalog part.
 *
 * Pure and client-safe (the grid-bom rule): no doc-store, no DB. The
 * store is src/lib/stores/device-types.ts; the palette, Layers, legends,
 * Grid Settings and the harness all import this file.
 * ------------------------------------------------------------------ */
import { isDocumentId } from "@/lib/part-docs/types";
import { isGridLayer, UNSCOPED, type GridLayer } from "./grid-scopes";

export type DeviceType = {
  key: string;
  label: string;
  scope: GridLayer;
  order: number;
  archived?: boolean;
  /** grid-icons id; checked with isGridIconId where it is resolved
   *  (grid-icons symbolContext) — this file cannot import the registry. */
  icon?: string | null;
  /** #300 (D606/D609): the type's object drawing — a `symbol` part document
   *  (`PD-…`) every part of this type falls back to when it has no drawing
   *  of its own (resolveObjectSymbol). Kept only when the id is well formed. */
  symbolDocId?: string;
};

export type TypeMapEntry = { typeKey: string | null; by: "auto" | "admin"; at: number };
/** normalized raw category → entry. `typeKey: null` + `by: "admin"` is a
 *  deliberate "not a Grid device type" that auto-apply never touches. */
export type TypeMap = Record<string, TypeMapEntry>;
export type DeviceTypeContext = { types: DeviceType[]; map: TypeMap };
export type Suggestion = { typeKey: string; confidence: "high" | "low" };

export const DEVICE_TYPES_BLOB = "gridDeviceTypes";
export const TYPE_MAP_BLOB = "gridTypeMap";
export const favoritesBlobId = (userId: string) => `gridFavorites:${userId}`;
export const recentBlobId = (userId: string) => `gridRecent:${userId}`;
export const FAVORITES_CAP = 300;
export const RECENT_CAP = 40;
export const MAX_DEVICE_TYPES = 60;
/** Pseudo type keys for the palette chips and the Layers rows. */
export const UNMAPPED_TYPE = "__unmapped";
export const ASSEMBLY_TYPE = "__assembly";
export const ALLOWANCE_TYPE = "__allowance";
export const UNMAPPED_LABEL = "Unmapped";
/** The seeded type a curtain drop-in (`GridPlacement.curtain`) belongs to
 *  by construction — its Layers row, the way its scope is Curtains. */
export const DRAPERY_TYPE_KEY = "drapery";

const SEED: ReadonlyArray<[string, GridLayer]> = [
  ["Fixtures", "Lighting"], ["Dimming & Power", "Lighting"], ["Control & Networking", "Lighting"], ["Lighting Accessories", "Lighting"],
  ["Hoists & Motors", "Rigging"], ["Truss & Pipe", "Rigging"], ["Rigging Hardware", "Rigging"], ["Rigging Control", "Rigging"],
  ["Drapery", "Curtains"], ["Tracks & Hardware", "Curtains"],
  ["Speakers", "Audio"], ["Microphones", "Audio"], ["Mixing & Processing", "Audio"], ["Amplifiers", "Audio"], ["Assistive Listening", "Audio"], ["Intercom", "Audio"],
  ["Displays & Projectors", "Video"], ["Screens & Lifts", "Video"], ["Cameras", "Video"], ["Switching & Distribution", "Video"],
  ["Cable & Connectors", UNSCOPED], ["Racks & Cases", UNSCOPED], ["Power Distribution", UNSCOPED], ["Networking", UNSCOPED], ["Parts & Consumables", UNSCOPED],
];

export function slugOf(label: string): string {
  return label
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export const SEED_DEVICE_TYPES: readonly DeviceType[] = SEED.map(([label, scope], i) => ({ key: slugOf(label), label, scope, order: (i + 1) * 10 }));

/** Shipped glyph per seeded type (grid-icons ids; the harness pins each). */
export const DEFAULT_TYPE_ICONS: Record<string, string> = {
  fixtures: "fixture",
  "dimming-power": "dimmer",
  "control-networking": "lighting-controls",
  "lighting-accessories": "spotlight",
  "hoists-motors": "motor",
  "truss-pipe": "pipe",
  "rigging-hardware": "hardware",
  "rigging-control": "control-panel",
  drapery: "curtain",
  "tracks-hardware": "track",
  speakers: "speaker",
  microphones: "microphone",
  "mixing-processing": "faders",
  amplifiers: "amplifier",
  "assistive-listening": "assistive-listening",
  intercom: "intercom",
  "displays-projectors": "display",
  "screens-lifts": "screen",
  cameras: "camera",
  "switching-distribution": "distribution",
  "cable-connectors": "cable",
  "racks-cases": "rack",
  "power-distribution": "power",
  networking: "network",
  "parts-consumables": "kit",
};

const KEY_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ICON_RE = /^[a-z0-9-]{1,40}$/;
const byOrder = (a: DeviceType, b: DeviceType) => a.order - b.order || a.label.localeCompare(b.label);

/** Trimmed, lower-cased, whitespace collapsed; "" for nothing (and for
 *  "__proto__", which must never become an object key). */
export function normalizeRawCategory(raw: string | null | undefined): string {
  const k = (raw || "").trim().toLowerCase().replace(/\s+/g, " ");
  return k === "__proto__" ? "" : k;
}

function cleanType(raw: unknown): DeviceType | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const key = typeof r.key === "string" ? r.key.trim() : "";
  const label = typeof r.label === "string" ? r.label.trim().replace(/\s+/g, " ").slice(0, 40) : "";
  const scope = r.scope;
  if (!KEY_RE.test(key) || !label || !isGridLayer(scope)) return null;
  const t: DeviceType = { key, label, scope, order: typeof r.order === "number" && Number.isFinite(r.order) ? r.order : 0 };
  if (r.archived === true) t.archived = true;
  if (typeof r.icon === "string" && ICON_RE.test(r.icon)) t.icon = r.icon;
  if (isDocumentId(r.symbolDocId)) t.symbolDocId = r.symbolDocId;
  return t;
}

/** Stored list (full replacement) sanitized; any seeded type missing from it
 *  is appended so a type shipped later still appears. Never deletes: a type
 *  leaves the palette only by being archived. Absent/invalid → fresh seeds. */
export function deviceTypesFrom(raw: unknown): DeviceType[] {
  if (!Array.isArray(raw)) return SEED_DEVICE_TYPES.map((t) => ({ ...t }));
  const out: DeviceType[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    const t = cleanType(r);
    if (!t || seen.has(t.key)) continue;
    seen.add(t.key);
    out.push(t);
    if (out.length >= MAX_DEVICE_TYPES) break;
  }
  let max = out.reduce((m, t) => Math.max(m, t.order), 0);
  for (const s of SEED_DEVICE_TYPES) {
    if (seen.has(s.key)) continue;
    max += 10;
    out.push({ ...s, order: max });
  }
  return out.sort(byOrder);
}

/* ------------------------- suggestion rules ------------------------- */

type Rule = { typeKey: string; conf: "high" | "low"; re: RegExp };
const H = (typeKey: string, re: RegExp): Rule => ({ typeKey, conf: "high", re });
const L = (typeKey: string, re: RegExp): Rule => ({ typeKey, conf: "low", re });

/** Categories that name no device at all. */
const EXCLUDED = new Set(["fabric", "labor"]);
const GENERIC = new Set(["uncategorized", "other", "misc", "miscellaneous", "general", "accessory", "accessories", "n/a", "none", "unknown"]);
/** Dealer-sheet brand buckets too broad to guess from (convert-dealer-sheets.py BRAND_CATEGORY). */
const BLOCK = /\b(av control|av infrastructure|networked av|staging|stage accessories)\b/;

/** First match wins, so the order is load-bearing: specific phrases before
 *  the single words they contain ("motor control" before "motor", "led
 *  video" before "led", "power controls" before "power", "safety cables"
 *  before "cables"). High rules are unambiguous on their own; low rules are
 *  single words that often but not always mean that type.
 *
 *  Head-noun precedence (fix wave #226): a compound category is read the
 *  way a person reads it — by its head noun (its last significant word),
 *  not by whichever word happens to sit earliest in this array. "DMX
 *  Cable" and "Speaker Cable" are cables, not control-networking/speakers,
 *  because "Cable" is what's being described; "DMX"/"Speaker" only say
 *  which cable. `suggestDeviceType` enforces this in two ways below rather
 *  than by reordering RULES (reordering only fixes the one pair you tested
 *  and silently breaks another): (1) an absolute cable/connector/adapter/
 *  snake/whip/jumper/extension check that wins regardless of anything else
 *  in the string, and (2) demoting the bare, genuinely ambiguous head nouns
 *  ("track" alone reads as either curtain-track hardware or lighting
 *  track) to `L` here, with a small same-scope compound boost below
 *  ("Curtain Track" → tracks-hardware high; "Lighting Track" or bare
 *  "Track" alone → low, never confidently wrong). */
const RULES: readonly Rule[] = [
  H("rigging-control", /\b(rigging|motor|hoist) control(s|ler|lers)?\b/),
  H("hoists-motors", /\b(hoists?|motors?|motorized|winch(es)?)\b/),
  // Bare "truss" wins over a later head noun like "clamps" for e.g. "Truss
  // Clamps" (#226 fix wave 2) — left as is on purpose, not a bug: a truss
  // clamp genuinely is truss/rigging hardware, unlike "Speaker Mounts"
  // where the head noun says nothing about which device is mounted.
  H("truss-pipe", /\b(truss(es|ing)?|pipes?|battens?)\b/),
  // "tracks?" alone is deliberately NOT here — see the head-noun comment
  // above and the L("tracks-hardware", …) rule below.
  H("tracks-hardware", /\b(carriers?|travell?ers?)\b/),
  H("drapery", /\b(drapes?|drapery|curtains?|scrims?|velour|cyc fabric|masking)\b/),
  H("rigging-hardware", /\b(shackles?|wire rope|slings?|loft ?blocks?|head ?blocks?|mule blocks?|floor blocks?|arbors?|rope locks?|shoes|strain reliefs?|hooks?|turnbuckles?)\b/),
  // The full phrase "rigging hardware" names the type exactly, so it stays
  // high (regression guard, fix wave 1) even though the bare word
  // "hardware" alone doesn't (#226 fix wave 2) — see the L("rigging-hardware",
  // …) rule below.
  H("rigging-hardware", /\brigging hardware\b/),
  // "hardware" and "mounts?"/"brackets?" are deliberately NOT here (#226 fix
  // wave 2) — see the mount/bracket head-noun comment above RULES and the
  // L("rigging-hardware", …) rule below.
  H("assistive-listening", /\b(assistive|als|hearing loops?|induction loops?|listening)\b/),
  H("intercom", /\b(intercoms?|comms?|clear ?com|party ?line|beltpacks?)\b/),
  H("microphones", /\b(mics?|microphones?)\b/),
  H("amplifiers", /\b(amps?|amplifiers?|amplification)\b/),
  H("mixing-processing", /\b(dsps?|mixers?|mixing|audio consoles?|processors?|processing|audio controls?)\b/),
  H("speakers", /\b(speakers?|loudspeakers?|subs?|subwoofers?|line arrays?|stage monitors?)\b/),
  H("cameras", /\b(cameras?|ptz|camcorders?)\b/),
  H("screens-lifts", /\b(screens?|lifts?)\b/),
  H("displays-projectors", /\b(displays?|projectors?|projection|led video|video walls?|led walls?|tvs?)\b/),
  H("switching-distribution", /\b(switchers?|switching|matrix|matrices|av distribution|video distribution|distribution amps?|extenders?|hdbaset|scalers?|video controls?|encoders?|decoders?)\b/),
  H("dimming-power", /\b(dimmers?|dimming|relays?|relay panels?|power controls?)\b/),
  H("power-distribution", /\b(power distribution|distro|distro boxes?|pdus?|power strips?|surge|power conditioners?|sequencers?)\b/),
  H("networking", /\b(network|networking|network switch(es)?|routers?|access points?|ethernet|fiber)\b/),
  H("control-networking", /\b(lighting controls?|lighting consoles?|dmx|sacn|gateways?|nodes?)\b/),
  H("lighting-accessories", /\b(lens(es)?|iris(es)?|gobos?|yokes?|lighting accessories|color frames?|top hats?|barn ?doors?|safety cables?)\b/),
  H("fixtures", /\b(fixtures?|luminaires?|leds?|spots?|spotlights?|wash(es)?|ellipsoidals?|fresnels?|pars?|cyc|moving lights?|followspots?|house ?lights?|work ?lights?)\b/),
  // Bare "parts" is dropped from here (#226 fix wave 2) — see the
  // L("parts-consumables", …) rule below.
  H("parts-consumables", /\b(lamps?|consumables?|filters?|gels?|batteries|fluids?)\b/),
  H("cable-connectors", /\b(cables?|cabling|connectors?|adapters?|wire|wiring|cable assemblies|crossovers?|snakes?|multicores?)\b/),
  // Bare "cases?" is dropped from here (#226 fix wave 2) — see the
  // L("racks-cases", …) rule below.
  H("racks-cases", /\b(racks?|carts?)\b/),
  L("control-networking", /\b(controls?|controllers?|consoles?)\b/),
  L("fixtures", /\b(lighting|lights?|architectural)\b/),
  L("displays-projectors", /\bmonitors?\b/),
  L("microphones", /\bwireless\b/),
  L("power-distribution", /\bpower\b/),
  // "hardware" joins "rigging" here (#226 fix wave 2): bare "Hardware" is as
  // generic as bare "Mounts" — "Mounting Hardware", "Curtain Hardware" name
  // no device — so it's low, never a confident auto-apply.
  L("rigging-hardware", /\b(rigging|hardware)\b/),
  L("lighting-accessories", /\bclamps?\b/),
  // Bare "track(s)" — see the head-noun comment above the RULES declaration.
  L("tracks-hardware", /\btracks?\b/),
  // Generic accessory-container head nouns (#226 fix wave 2, same class as
  // "mounts?"/"brackets?" below): the modifier, not "cases"/"parts" itself,
  // says what's inside, so a bare match is never a confident auto-apply.
  L("racks-cases", /\bcases?\b/),
  L("parts-consumables", /\bparts\b/),
];

const words = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
const firstRule = (text: string) => RULES.find((r) => r.re.test(text)) ?? null;

/** Head-noun precedence, absolute case (#226 fix wave): whatever else the
 *  category says, a cable/connector/adapter/snake/whip/jumper/extension
 *  word makes it Cable & Connectors — "DMX Cable" and "Speaker Cable" are
 *  cables, not control-networking/speakers. */
const CABLE_HEAD_RE = /\b(cables?|cabling|connectors?|adapters?|snakes?|whips?|jumpers?|extensions?)\b/;
/** A Curtains-domain word that legitimizes a bare "track" as curtain-track
 *  hardware ("Curtain Track" → tracks-hardware high). Without one, "track"
 *  is read alone and stays low (see the L("tracks-hardware", …) rule). */
const CURTAIN_WORD_RE = /\b(curtains?|drapes?|drapery|cyc|scrims?|velour|masking)\b/;

/**
 * A bare "mount(s)"/"bracket(s)" is a hookup accessory for some OTHER
 * device, never a device type of its own (#226 fix wave 2) — the same class
 * of mistake as the pre-fix "DMX Cable" → control-networking bug, but the
 * old rule ("hardware|mounts?|hooks?" all lumped into rigging-hardware HIGH)
 * made it worse by also being confidently wrong: "Speaker Mounts",
 * "Projector Mounts", "TV Mounts" all auto-applied to Rigging. Here the
 * modifier — not the head noun — says which device it mounts, and even a
 * good modifier match stays LOW (a mount is still an accessory; it always
 * needs a human to confirm). Only an explicit rigging word ("Rigging
 * Mounts", "Beam Clamps & Mounts") keeps a mount in rigging-hardware, and
 * still only at low confidence — never "high", per the mounts fix. Bare
 * "Mounts"/"Mount"/"Rigid Mount"/"Brackets" carry no device information at
 * all and get no suggestion.
 */
const MOUNT_HEAD_RE = /\b(mounts?|brackets?)\b/;
const MOUNT_RIGGING_WORD_RE = /\b(rigging|beam)\b/;
const MOUNT_MODIFIER_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bspeakers?\b/, "speakers"],
  [/\b(projectors?|tvs?|displays?|monitors?)\b/, "displays-projectors"],
  [/\bcameras?\b/, "cameras"],
  [/\b(truss(es)?|pipes?)\b/, "truss-pipe"],
  [/\b(fixtures?|lights?)\b/, "lighting-accessories"],
];

/**
 * The category string decides (its rule's confidence). Only when it matches
 * nothing do up to 20 sample part descriptions vote, and a vote is never
 * better than "low" — auto-apply acts on category evidence alone. Generic,
 * excluded and brand-bucket categories never get a suggestion.
 */
export function suggestDeviceType(category: string, sampleDescs: readonly string[] = []): Suggestion | null {
  const key = normalizeRawCategory(category);
  if (!key || EXCLUDED.has(key) || GENERIC.has(key) || BLOCK.test(words(key))) return null;
  const text = words(key);
  if (CABLE_HEAD_RE.test(text)) return { typeKey: "cable-connectors", confidence: "high" };
  if (/\btracks?\b/.test(text) && CURTAIN_WORD_RE.test(text)) return { typeKey: "tracks-hardware", confidence: "high" };
  if (MOUNT_HEAD_RE.test(text)) {
    for (const [re, typeKey] of MOUNT_MODIFIER_RULES) if (re.test(text)) return { typeKey, confidence: "low" };
    if (MOUNT_RIGGING_WORD_RE.test(text)) return { typeKey: "rigging-hardware", confidence: "low" };
    return null;
  }
  const hit = firstRule(text);
  if (hit) return { typeKey: hit.typeKey, confidence: hit.conf };
  const votes = new Map<string, number>();
  for (const d of sampleDescs.slice(0, 20)) {
    const r = firstRule(words(d || ""));
    if (r) votes.set(r.typeKey, (votes.get(r.typeKey) || 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const r of RULES) {
    const n = votes.get(r.typeKey) || 0;
    if (n > bestN) {
      best = r.typeKey;
      bestN = n;
    }
  }
  return best ? { typeKey: best, confidence: "low" } : null;
}

/* ------------------------------ the map ------------------------------ */

/**
 * The map key `raw` normalizes to, or null when it can never be written to
 * the type map: blank, an excluded head noun (fabric/labor), or longer than
 * the 120-char key limit `sanitizeTypeMap` enforces on read. Every writer
 * (autoTypeEntries, assignEntries, acceptSuggestionEntries) and
 * typeReviewRows share this one gate — before this fix, autoTypeEntries had
 * no length check, so a >120-char raw category was auto-mapped, silently
 * dropped by sanitizeTypeMap on the very next read (because it's never
 * `Object.hasOwn(map, key)`), and auto-mapped again: an endless re-write on
 * every read, never actually idempotent (#226 fix wave 3).
 */
export function mapKeyOf(raw: string | null | undefined): string | null {
  const key = normalizeRawCategory(raw);
  if (!key || EXCLUDED.has(key) || key.length > 120) return null;
  return key;
}

export function sanitizeTypeMap(raw: unknown): TypeMap {
  const out: TypeMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = normalizeRawCategory(k);
    // Same gate as every writer (mapKeyOf): Fabric/Labor name no device, so a
    // stored entry for one is dropped on read (#226 final wave B).
    if (!key || EXCLUDED.has(key) || key.length > 120 || !v || typeof v !== "object") continue;
    const e = v as Record<string, unknown>;
    const typeKey = e.typeKey === null ? null : typeof e.typeKey === "string" && KEY_RE.test(e.typeKey) ? e.typeKey : undefined;
    if (typeKey === undefined || (e.by !== "auto" && e.by !== "admin")) continue;
    out[key] = { typeKey, by: e.by, at: typeof e.at === "number" && Number.isFinite(e.at) ? e.at : 0 };
  }
  return out;
}

/** The ACTIVE type a raw category maps to, or null (no entry, an admin
 *  "unmapped", an unknown or archived type, Fabric/Labor). */
export function typeOfCategory(category: string, map: TypeMap, types: readonly DeviceType[]): string | null {
  const key = normalizeRawCategory(category);
  if (!key || EXCLUDED.has(key)) return null;
  const e = Object.hasOwn(map, key) ? map[key] : undefined;
  if (!e || !e.typeKey) return null;
  const t = types.find((x) => x.key === e.typeKey);
  return t && !t.archived ? t.key : null;
}

export function typeOfPart(part: { category: string }, map: TypeMap, types: readonly DeviceType[]): string | null {
  return typeOfCategory(part.category, map, types);
}

export function scopeOfType(typeKey: string | null | undefined, types: readonly DeviceType[]): GridLayer {
  const t = typeKey ? types.find((x) => x.key === typeKey) : undefined;
  return t ? t.scope : UNSCOPED;
}

export function typeLabel(key: string, types: readonly DeviceType[]): string {
  if (key === UNMAPPED_TYPE) return UNMAPPED_LABEL;
  if (key === ASSEMBLY_TYPE) return "Assemblies";
  if (key === ALLOWANCE_TYPE) return "Allowances";
  return types.find((t) => t.key === key)?.label ?? key;
}

/**
 * The pre-#226 grid-catalog scopeFor() text heuristic, with its Lighting
 * fallback replaced by Unscoped (#48 intent: an unknown part is visible and
 * countable in Unscoped, never dumped into Lighting).
 */
export function keywordScopeOf(p: { category?: string; desc?: string; discipline?: string }): GridLayer {
  const text = `${p.category || ""} ${p.desc || ""} ${p.discipline || ""}`.toLowerCase();
  if (text.includes("curtain") || text.includes("fabric")) return "Curtains";
  // #226 fix wave: word/prefix match, not a bare substring — "Rigid Mount"
  // contains "rig" but isn't Rigging; "rig", "rigging" and "rigs" are.
  if (/\brig(ging|s)?\b/.test(text) || text.includes("truss")) return "Rigging";
  if (text.includes("video") || text.includes("sdi") || text.includes("hdmi")) return "Video";
  if (text.includes("audio") || text.includes("speaker") || text.includes("microphone")) return "Audio";
  return UNSCOPED;
}

/** Auto-apply (spec, Jeff 2026-09-26): every distinct category with NO map
 *  entry whose category string earns a HIGH suggestion for an active type.
 *  Gated by mapKeyOf, so Fabric/Labor and a >120-char category are skipped
 *  outright rather than relying on suggestDeviceType to return null for them
 *  (#226 fix wave 3 — the >120 case wasn't gated at all before). */
export function autoTypeEntries(parts: ReadonlyArray<{ category: string }>, map: TypeMap, types: readonly DeviceType[], now: number): TypeMap {
  const active = new Set(types.filter((t) => !t.archived).map((t) => t.key));
  const out: TypeMap = {};
  const seen = new Set<string>();
  for (const p of parts) {
    const key = mapKeyOf(p.category);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (Object.hasOwn(map, key)) continue;
    const s = suggestDeviceType(key);
    if (s && s.confidence === "high" && active.has(s.typeKey)) out[key] = { typeKey: s.typeKey, by: "auto", at: now };
  }
  return out;
}

export type TypeReviewRow = {
  key: string;
  category: string;
  count: number;
  suggestion: Suggestion | null;
  entry: TypeMapEntry | null;
  typeKey: string | null;
  status: "unmapped" | "auto" | "admin" | "toolong";
};

const STATUS_RANK: Record<TypeReviewRow["status"], number> = { unmapped: 0, auto: 1, admin: 2, toolong: 3 };

/** Catalog → Device types rows: one per distinct raw category (first
 *  spelling wins), Fabric/Labor/blank left out; unmapped first, then auto,
 *  then admin, then the read-only too-long rows; most parts first within
 *  each. A category longer than the map's 120-char key limit can never be
 *  written (mapKeyOf), so it gets its own "toolong" status instead of
 *  showing as perpetually "unmapped" — a status that would invite an
 *  assign/accept that silently does nothing (#226 fix wave 3). */
export function typeReviewRows(parts: ReadonlyArray<{ category: string; desc?: string }>, map: TypeMap, types: readonly DeviceType[]): TypeReviewRow[] {
  const groups = new Map<string, { category: string; count: number; descs: string[] }>();
  for (const p of parts) {
    const key = normalizeRawCategory(p.category);
    if (!key || EXCLUDED.has(key)) continue;
    let g = groups.get(key);
    if (!g) {
      g = { category: (p.category || "").trim().replace(/\s+/g, " "), count: 0, descs: [] };
      groups.set(key, g);
    }
    g.count += 1;
    if (p.desc && g.descs.length < 5) g.descs.push(p.desc);
  }
  const rows: TypeReviewRow[] = [];
  for (const [key, g] of groups) {
    if (!mapKeyOf(key)) {
      rows.push({ key, category: g.category, count: g.count, suggestion: null, entry: null, typeKey: null, status: "toolong" });
      continue;
    }
    const entry = Object.hasOwn(map, key) ? map[key] : null;
    const typeKey = typeOfCategory(key, map, types);
    const status: TypeReviewRow["status"] = !typeKey || !entry ? "unmapped" : entry.by;
    rows.push({ key, category: g.category, count: g.count, suggestion: suggestDeviceType(key, g.descs), entry, typeKey, status });
  }
  return rows.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.count - a.count || a.category.localeCompare(b.category));
}

/** "Accept all suggestions": admin entries for every unmapped row that has
 *  no entry at all (an admin "unmapped" is a decision, not a gap) and any
 *  suggestion, low included, for an active type. mapKeyOf is a second,
 *  defensive gate — status "unmapped" already excludes "toolong" rows, but
 *  every writer agrees on the same gate rather than trusting the caller's
 *  status field alone (#226 fix wave 3). */
export function acceptSuggestionEntries(rows: readonly TypeReviewRow[], types: readonly DeviceType[], now: number): TypeMap {
  const active = new Set(types.filter((t) => !t.archived).map((t) => t.key));
  const out: TypeMap = {};
  for (const r of rows) {
    if (r.status !== "unmapped" || r.entry || !r.suggestion || !active.has(r.suggestion.typeKey)) continue;
    const key = mapKeyOf(r.key);
    if (!key) continue;
    out[key] = { typeKey: r.suggestion.typeKey, by: "admin", at: now };
  }
  return out;
}

export function assignEntries(categories: readonly string[], typeKey: string | null, now: number): TypeMap {
  const out: TypeMap = {};
  for (const c of categories) {
    const key = mapKeyOf(String(c ?? ""));
    if (!key) continue;
    out[key] = { typeKey, by: "admin", at: now };
  }
  return out;
}

export function mergeTypeEntries(map: TypeMap, fromKey: string, toKey: string, now: number): TypeMap {
  const out: TypeMap = {};
  for (const [k, e] of Object.entries(map)) if (e.typeKey === fromKey) out[k] = { typeKey: toKey, by: "admin", at: now };
  return out;
}

/**
 * The Device types list editor's save. Input is the whole ordered list
 * (existing rows carry `key`, new rows don't). Rename keeps the key; a new
 * row gets a unique slug key; a row missing from the input is archived,
 * never deleted (the map may still point at it); icons are Grid Settings'
 * business and always carried over from `current`.
 */
export function cleanDeviceTypesInput(
  input: unknown,
  current: readonly DeviceType[]
): { ok: true; types: DeviceType[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "Nothing to save." };
  if (input.length > MAX_DEVICE_TYPES) return { ok: false, error: `At most ${MAX_DEVICE_TYPES} device types.` };
  const byKey = new Map(current.map((t) => [t.key, t]));
  const out: DeviceType[] = [];
  const keys = new Set<string>();
  const labels = new Set<string>();
  for (const [i, raw] of input.entries()) {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim().replace(/\s+/g, " ") : "";
    if (!label) return { ok: false, error: "Every device type needs a name." };
    if (label.length > 40) return { ok: false, error: `"${label.slice(0, 40)}…" is longer than 40 characters.` };
    const scope = r.scope;
    if (!isGridLayer(scope)) return { ok: false, error: `Pick a scope for "${label}".` };
    const existing = typeof r.key === "string" ? byKey.get(r.key) ?? null : null;
    let key = existing ? existing.key : slugOf(label);
    if (!existing) {
      if (!key) return { ok: false, error: `"${label}" needs at least one letter or number.` };
      const base = key.slice(0, 36);
      let n = 2;
      while (keys.has(key) || byKey.has(key)) key = `${base}-${n++}`;
    }
    if (keys.has(key)) return { ok: false, error: "The same device type appears twice." };
    const archived = r.archived === true;
    const lower = label.toLowerCase();
    if (!archived && labels.has(lower)) return { ok: false, error: `Two device types are called "${label}".` };
    keys.add(key);
    if (!archived) labels.add(lower);
    const t: DeviceType = { key, label, scope, order: (i + 1) * 10 };
    if (archived) t.archived = true;
    if (existing?.icon) t.icon = existing.icon;
    if (existing?.symbolDocId) t.symbolDocId = existing.symbolDocId;
    out.push(t);
  }
  for (const t of current) if (!keys.has(t.key)) out.push({ ...t, archived: true, order: (out.length + 1) * 10 });
  return { ok: true, types: out };
}

/** Set (string) or clear (null) the icon of the named types; others untouched. */
export function withTypeIcons(types: readonly DeviceType[], icons: Record<string, string | null>): DeviceType[] {
  return types.map((t) => {
    const next: DeviceType = { ...t };
    if (!Object.hasOwn(icons, t.key)) return next;
    const v = icons[t.key];
    if (typeof v === "string" && ICON_RE.test(v)) next.icon = v;
    else delete next.icon;
    return next;
  });
}

/** Set (a `PD-…` id) or clear (null / anything malformed) the object
 *  drawing of the named type; others untouched (#300). */
export function withTypeSymbol(types: readonly DeviceType[], typeKey: string, docId: string | null): DeviceType[] {
  return types.map((t) => {
    const next: DeviceType = { ...t };
    if (t.key !== typeKey) return next;
    if (isDocumentId(docId)) next.symbolDocId = docId;
    else delete next.symbolDocId;
    return next;
  });
}

/** Active type key → icon id (own icon, else the shipped default). */
export function deviceTypeIcons(types: readonly DeviceType[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of types) {
    if (t.archived) continue;
    const id = t.icon || (Object.hasOwn(DEFAULT_TYPE_ICONS, t.key) ? DEFAULT_TYPE_ICONS[t.key] : undefined);
    if (id) out[t.key] = id;
  }
  return out;
}

/** The palette-chip / layer key of a resolved part. Assemblies and
 *  allowances are Grid-owned and never "unmapped". */
export function typeKeyOfPart(
  p: { id?: string; deviceType?: string | null; kind?: string; allowance?: boolean } | null | undefined
): string {
  if (!p) return UNMAPPED_TYPE;
  if (p.allowance) return ALLOWANCE_TYPE;
  if (p.kind === "assembly" || (p.id || "").startsWith("asm:")) return ASSEMBLY_TYPE;
  return p.deviceType || UNMAPPED_TYPE;
}

export type TypeLayerRow = { key: string; label: string; count: number; subs: string[] };

/** Layers: per scope, one row per device type in type order; Assemblies,
 *  Allowances, then Unmapped last. `sub` (an unmapped item's raw/seeded
 *  category) collects up to three distinct sub-labels — never a layer. */
export function typeLayerRows(
  items: ReadonlyArray<{ scope: GridLayer; typeKey: string; sub?: string | null }>,
  types: readonly DeviceType[]
): Map<GridLayer, TypeLayerRow[]> {
  const order = new Map(types.map((t, i) => [t.key, i]));
  const rank = (k: string) =>
    k === UNMAPPED_TYPE ? 3e6 : k === ALLOWANCE_TYPE ? 2e6 + 1 : k === ASSEMBLY_TYPE ? 2e6 : order.get(k) ?? 1e6;
  const byScope = new Map<GridLayer, Map<string, TypeLayerRow>>();
  for (const it of items) {
    let m = byScope.get(it.scope);
    if (!m) {
      m = new Map();
      byScope.set(it.scope, m);
    }
    let r = m.get(it.typeKey);
    if (!r) {
      r = { key: it.typeKey, label: typeLabel(it.typeKey, types), count: 0, subs: [] };
      m.set(it.typeKey, r);
    }
    r.count += 1;
    const sub = (it.sub || "").trim();
    if (sub && !r.subs.includes(sub) && r.subs.length < 3) r.subs.push(sub);
  }
  const out = new Map<GridLayer, TypeLayerRow[]>();
  for (const [scope, m] of byScope) out.set(scope, [...m.values()].sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label)));
  return out;
}

/* ------------------------ favorites / recent ------------------------ */

export function cleanIdList(raw: unknown, cap: number): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !v.trim() || v.length > 120 || out.includes(v)) continue;
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

export function withRecent(list: readonly string[], id: string, cap = RECENT_CAP): string[] {
  if (!id || !id.trim() || id.length > 120) return [...list];
  return [id, ...list.filter((x) => x !== id)].slice(0, cap);
}

export function toggleInList(
  list: readonly string[],
  id: string,
  cap = FAVORITES_CAP
): { ok: true; list: string[]; on: boolean } | { ok: false; error: string } {
  if (!id || !id.trim() || id.length > 120) return { ok: false, error: "That part can't be starred." };
  if (list.includes(id)) return { ok: true, list: list.filter((x) => x !== id), on: false };
  if (list.length >= cap) return { ok: false, error: `You have ${cap} favorites — unstar one first.` };
  return { ok: true, list: [id, ...list], on: true };
}
