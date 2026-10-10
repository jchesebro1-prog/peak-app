/**
 * Riser tag suggestions (#328 A) — Bray's designator code plus the tag-block
 * defaults a lighting-control part usually carries, guessed from its model,
 * description and category. A pure table, first match wins, case-insensitive;
 * `undefined` = leave the cell blank. Box is never suggested (gang count isn't
 * knowable from the catalog). The riser data sheet shows these as "suggested"
 * for Jeff to review — nothing is stored until he uploads and applies.
 */

import type { TagFields } from "./tags";

export type SuggestedTagDefaults = { code?: string } & TagFields;
export type SuggestInput = { model?: string; desc?: string; category?: string };
export type SuggestRule = { id: string; test: (haystack: string) => boolean; values: SuggestedTagDefaults };

const has = (re: RegExp) => (h: string) => re.test(h);
const all = (...tests: Array<(h: string) => boolean>) => (h: string) => tests.every((t) => t(h));

const DMX = has(/\bdmx\b/);
const OUTLET_OR_PORT = has(/\b(outlets?|ports?|receptacles?)\b/);
const NETWORK = has(/\b(network|ethernet|rj-?45)\b/);
/** "network outlet", "RJ45 data outlet", "ethernet wall plate" — the qualifier sits within two words of the outlet.
 *  Ports and jacks do not count: a "network switch, 24 ports" is not a wall outlet. */
const NETWORK_OUTLET = has(/\b(network|ethernet|rj-?45|data)\b(\s+\S+){0,2}?\s+(outlets?|receptacles?|wall plates?)\b/);

/** A dimmer / relay / sensor rack or panel. Adjacent words only ("dimmer touch panel" is a touch panel);
 *  "touch panel" never counts as the panel noun, and an occupancy / vacancy sensor panel ("Occupancy sensor
 *  panel-mount") or a "sensor panel-…" is a mounting phrase, not a panel. Model-shaped tokens (DRd6, ERn) count on
 *  their own; brand-only tokens (Unison, Sensor3, Sensor+) need a rack / panel noun in the same field, so
 *  "Unison Echo Button Station" and "Sensor+ touchscreen controller" stay out. */
const DIMMER_RACK = (h: string) => {
  const t = h.replace(/touch\s?panels?/g, " ");
  return (
    /\b(dimmer|relay|dimming)s?(\s*[/&]\s*(dimmer|relay)s?)?\s+(racks?|panels?)\b/.test(t) ||
    /(?<!\b(?:occupancy|vacancy)\s)\bsensor\s+(racks?|panels?)\b(?!-)/.test(t) ||
    /\b(drd|ern)\d*(?=\W|$)/.test(t) ||
    (/\b(unison|sensor3|sensor\+)(?=\W|$)/.test(t) && /\b(racks?|panels?)\b/.test(t))
  );
};

/** The table, most-specific device kind first (a DMX emergency bypass controller with ports is a DEBC,
 *  not an outlet). The outlets come last, CRON (DMX + network) before CRO and CRN. */
export const SUGGEST_RULES: readonly SuggestRule[] = [
  { id: "EBDK", test: has(/emergency bypass detect|\belts\b|\bbcm\s+sens/), values: { code: "EBDK", mount: "SM" } },
  { id: "DEBC", test: has(/emergency bypass controller|dmx emergency bypass/), values: { code: "DEBC", mount: "SM" } },
  {
    id: "DR",
    test: DIMMER_RACK,
    values: { code: "DR", mount: "SM" },
  },
  { id: "ER", test: has(/equipment rack|\benclosures?\b/), values: { code: "ER", mount: "FM" } },
  { id: "TS", test: has(/touch\s?screen|touch panel/), values: { code: "TS", mount: "FM", height: '48"' } },
  { id: "EP", test: has(/button station|relay station|\bkeypads?\b|control station|\bpresets?\b|scene station/), values: { code: "EP", mount: "FM", height: '48"' } },
  { id: "OCC", test: has(/\b(occupancy|vacancy)\s+sensors?\b/), values: { code: "OCC", mount: "CS" } },
  { id: "LVJB", test: has(/junction box|pull box/), values: { code: "LVJB", mount: "SM", pd: "P/D" } },
  { id: "CRON", test: all(DMX, NETWORK, OUTLET_OR_PORT), values: { code: "CRON", face: "O/N", mount: "SM", height: '18"', pd: "P/D" } },
  { id: "CRO", test: all(DMX, has(/\b(outlets?|ports?|receptacles?)\b|connector panel/)), values: { code: "CRO", face: "DMXO", mount: "SM", height: '18"', pd: "P/D" } },
  { id: "CRN", test: NETWORK_OUTLET, values: { code: "CRN", face: "NET", mount: "SM", height: '18"', pd: "P/D" } },
];

/** The first matching rule's values (a fresh object), or {} when none match. Each field (model, description,
 *  category) is matched on its own — a rule never reads across a field boundary. */
export function suggestTagDefaults(part: SuggestInput): SuggestedTagDefaults {
  const fields = [part.model, part.desc, part.category].map((f) => (f || "").toLowerCase()).filter(Boolean);
  if (!fields.length) return {};
  for (const r of SUGGEST_RULES) if (fields.some((f) => r.test(f))) return { ...r.values };
  return {};
}
