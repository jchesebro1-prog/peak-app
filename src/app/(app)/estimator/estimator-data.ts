import { FIXTURE_RATE_DEFAULTS, type FixtureRates } from "@/lib/fixture-rates";
import type { FixtureDraft, SpecSection } from "./types";

/**
 * Estimator built-in data — ported VERBATIM from Estimator.dc.html's logic
 * class (per IDEAS #43 the fixture list + add-on rates shipped in the screen,
 * not the catalog). Values are the spec; do not edit without a DECISIONS.md
 * entry.
 */

export type FixtureDef = {
  sku: string;
  family: string;
  name: string;
  list: number;
  cost: number;
};

/** Built-in lighting fixtures — 17 fixtures across 6 families. */
export const FIXTURES: FixtureDef[] = [
  { sku: "ETC-S4-26",  family: "Conventional",   name: "ETC Source Four 26° ERS", list: 520,  cost: 340 },
  { sku: "ETC-S4-36",  family: "Conventional",   name: "ETC Source Four 36° ERS", list: 520,  cost: 340 },
  { sku: "ETC-S4PAR",  family: "Conventional",   name: "ETC Source Four PAR",     list: 360,  cost: 235 },
  { sku: "ALT-FRES6",  family: "Conventional",   name: "Altman 6″ Fresnel",       list: 280,  cost: 180 },
  { sku: "ETC-CS-PAR", family: "LED wash / par", name: "ETC ColorSource PAR",     list: 560,  cost: 370 },
  { sku: "CHV-CDPAR",  family: "LED wash / par", name: "Chauvet COLORdash Par-H", list: 320,  cost: 210 },
  { sku: "ETC-CS-SPOT",family: "LED wash / par", name: "ETC ColorSource Spot",    list: 780,  cost: 520 },
  { sku: "MAR-AURA",   family: "Moving head",    name: "Martin MAC Aura XB Wash", list: 3200, cost: 2200 },
  { sku: "CHV-ROGR2",  family: "Moving head",    name: "Chauvet Rogue R2 Spot",   list: 2400, cost: 1650 },
  { sku: "ROB-LB150",  family: "Moving head",    name: "Robe LEDBeam 150",        list: 2100, cost: 1450 },
  { sku: "LYC-1271",   family: "Followspot",     name: "Lycian 1271 Followspot",  list: 4200, cost: 2900 },
  { sku: "RJ-ROXIE",   family: "Followspot",     name: "Robert Juliat Roxie LED", list: 6800, cost: 4700 },
  { sku: "ETC-CS-CYC", family: "Cyc / strip",    name: "ETC ColorSource CYC",     list: 640,  cost: 430 },
  { sku: "ALT-SPCYC",  family: "Cyc / strip",    name: "Altman Spectra Cyc 100",  list: 720,  cost: 480 },
  { sku: "LED-BORDER", family: "Cyc / strip",    name: "LED Borderlight, 3-cell", list: 900,  cost: 600 },
  { sku: "LED-HOUSE",  family: "House & work",   name: "LED House Downlight",     list: 180,  cost: 110 },
  { sku: "LED-WORK",   family: "House & work",   name: "LED Work Light",          list: 95,   cost: 60 },
];

export type AddOn = { price: number; cost: number };

/**
 * Fixture add-on PRICE + COST tables (IDEAS #43).
 *
 * PRICE is no longer duplicated here — it is sourced from the Estimating
 * Rules "fixture" group (src/lib/stores/pricing.ts GROUPS, live blob
 * `fixture_rates`), the single source of truth. Editing a rate in Estimating
 * Rules reprices the Estimator's fixture configurator immediately.
 *
 * COST has no row in Estimating Rules (the rules table only exposes price,
 * per the rate() shape — one editable number per row) and stays here as the
 * only copy; it still feeds cost/margin math, untouched by rules edits.
 *
 * fixMounts()/fixAcc()/fixPwr()/fixLamps() take the live FixtureRates
 * (fetched server-side via getFixtureRates() and threaded down as a prop,
 * same pattern as EstimatorProps.laborRates) and default to
 * FIXTURE_RATE_DEFAULTS so any caller that omits them keeps today's exact
 * values.
 */

const MOUNT_COST: Record<string, number> = {
  "C-clamp": 11,
  "Half-coupler": 15,
  "Yoke": 0,
  "Floor base": 30,
  "Truss": 20,
  "None": 0,
};

const ACC_COST: Record<string, number> = {
  "Color frame": 8,
  "Gel": 5,
  "Gobo": 20,
  "Barn door": 38,
  "Top hat": 16,
  "Safety cable": 7,
};

const PWR_COST: Record<string, number> = {
  "Edison": 13,
  "Twist-lock": 21,
  "Soca": 52,
  "DMX": 16,
  "Dimmer/relay": 38,
};

const LAMP_COST: Record<string, number> = {
  "LED": 0,
  "575W HPL": 14,
  "750W HPL": 17,
  "1000W": 22,
};

export function fixMounts(rates: FixtureRates = FIXTURE_RATE_DEFAULTS): Record<string, AddOn> {
  return {
    "C-clamp": { price: rates.mountCclamp, cost: MOUNT_COST["C-clamp"] },
    "Half-coupler": { price: rates.mountHalfCoupler, cost: MOUNT_COST["Half-coupler"] },
    "Yoke": { price: 0, cost: 0 },
    "Floor base": { price: rates.mountFloorBase, cost: MOUNT_COST["Floor base"] },
    "Truss": { price: rates.mountTruss, cost: MOUNT_COST["Truss"] },
    "None": { price: 0, cost: 0 },
  };
}

export function fixAcc(rates: FixtureRates = FIXTURE_RATE_DEFAULTS): Record<string, AddOn> {
  return {
    "Color frame": { price: rates.accColorFrame, cost: ACC_COST["Color frame"] },
    "Gel": { price: rates.accGel, cost: ACC_COST["Gel"] },
    "Gobo": { price: rates.accGobo, cost: ACC_COST["Gobo"] },
    "Barn door": { price: rates.accBarnDoor, cost: ACC_COST["Barn door"] },
    "Top hat": { price: rates.accTopHat, cost: ACC_COST["Top hat"] },
    "Safety cable": { price: rates.accSafety, cost: ACC_COST["Safety cable"] },
  };
}

export function fixPwr(rates: FixtureRates = FIXTURE_RATE_DEFAULTS): Record<string, AddOn> {
  return {
    "Edison": { price: rates.pwrEdison, cost: PWR_COST["Edison"] },
    "Twist-lock": { price: rates.pwrTwistLock, cost: PWR_COST["Twist-lock"] },
    "Soca": { price: rates.pwrSoca, cost: PWR_COST["Soca"] },
    "DMX": { price: rates.dataDMX, cost: PWR_COST["DMX"] },
    "Dimmer/relay": { price: rates.pwrDimmer, cost: PWR_COST["Dimmer/relay"] },
  };
}

export function fixLamps(rates: FixtureRates = FIXTURE_RATE_DEFAULTS): Record<string, AddOn> {
  return {
    "LED": { price: 0, cost: 0 },
    "575W HPL": { price: rates.lamp575, cost: LAMP_COST["575W HPL"] },
    "750W HPL": { price: rates.lamp750, cost: LAMP_COST["750W HPL"] },
    "1000W": { price: rates.lamp1000, cost: LAMP_COST["1000W"] },
  };
}

export type FixtureAddOns = {
  mounts: Record<string, AddOn>;
  acc: Record<string, AddOn>;
  pwr: Record<string, AddOn>;
  lamps: Record<string, AddOn>;
  customCostFactor: number;
};

/** Bundle of the four add-on maps + the manual-entry cost factor, resolved
 *  from live (or default) FixtureRates in one call. */
export function fixtureAddOns(rates: FixtureRates = FIXTURE_RATE_DEFAULTS): FixtureAddOns {
  return {
    mounts: fixMounts(rates),
    acc: fixAcc(rates),
    pwr: fixPwr(rates),
    lamps: fixLamps(rates),
    customCostFactor: rates.customCostFactor,
  };
}

export type FixturePreset = {
  label: string;
  d: Partial<FixtureDraft>;
};

export const FIX_PRESETS: FixturePreset[] = [
  { label: "Front wash ×6",  d: { model: "ETC-CS-PAR", qty: "6", mount: "C-clamp",      accessories: ["Safety cable"], power: ["Edison", "DMX"],     lamp: "LED" } },
  { label: "Cyc wash ×4",    d: { model: "ETC-CS-CYC", qty: "4", mount: "C-clamp",      accessories: ["Safety cable"], power: ["Edison", "DMX"],     lamp: "LED" } },
  { label: "Movers ×4",      d: { model: "CHV-ROGR2",  qty: "4", mount: "Half-coupler", accessories: ["Safety cable"], power: ["Twist-lock", "DMX"], lamp: "LED" } },
  { label: "ERS special ×2", d: { model: "ETC-S4-26",  qty: "2", mount: "C-clamp",      accessories: ["Color frame", "Gobo", "Safety cable"], power: ["Edison"], lamp: "575W HPL" } },
  { label: "Work lights ×4", d: { model: "LED-WORK",   qty: "4", mount: "None",         accessories: [], power: ["Edison"], lamp: "LED" } },
];

/**
 * Labor/travel rate fallback — mirrors catalog-data.js so the configurator
 * works even if the catalog rows are missing. Live rates (catalog category
 * 'Labor', sku → cost) win.
 */
export const LABOR_RATES_FALLBACK: Record<string, number> = {
  "RIG-LBR": 50, "RIG-OT": 75, "RIG-SUP": 75,
  "LIG-LBR": 45, "LIG-OT": 60, "LIG-SUP": 75,
  "AUD-LBR": 48, "AUD-OT": 70, "AUD-SUP": 72,
  "VID-LBR": 48, "VID-OT": 70, "VID-SUP": 72,
  "SHP-PM": 90, "SHP-IN": 40, "DRF-SUB": 50,
  "TVL-MIL": 1, "TVL-HTL": 140, "TVL-FOD": 70,
  "EQP-LIFT": 750,
};

export const DISC_LABEL: Record<string, string> = {
  RIG: "Rigging",
  LIG: "Lighting",
  AUD: "Audio",
  VID: "Video",
};

/** PM & drafting hours default to a % of total regular labor hours, per scope. */
export const LABOR_PCT: Record<string, number> = {
  RIG: 0.10,
  LIG: 0.05,
  AUD: 0.05,
  VID: 0.10,
};

/** Starter mobilization types — the Label field is an editable combobox. */
export const MOB_TYPES = ["Site Visit", "Install", "Hang", "Commissioning", "Training"];

export type SuggestPart = {
  sku: string;
  desc: string;
  cost: number;
  price: number;
  unit: string;
};

/** Per-system quick-add suggestions (keyed by the demo section ids). */
export const SUGGEST: Record<string, SuggestPart[]> = {
  rig: [
    { sku: "CL-LB-UH",   desc: "Loft block, under-hung",            cost: 100,  price: 145,  unit: "ea" },
    { sku: "CL-PIPE-26", desc: "Batten pipe, 1.5″ sch.40, 26′",     cost: 78,   price: 120,  unit: "ea" },
    { sku: "CL-SPLT",    desc: "Spreader plate, galvanized",        cost: 44,   price: 70,   unit: "ea" },
  ],
  soft: [
    { sku: "RB-SCRIM", desc: "Sharkstooth scrim, 48′ × 24′, black",  cost: 2600, price: 3900, unit: "ea" },
    { sku: "RB-TRAV",  desc: "Black traveler track, 54′, walkalong", cost: 1450, price: 2300, unit: "set" },
  ],
  hoist: [
    { sku: "ETC-PD-LB",   desc: "Prodigy loft block kit",     cost: 210, price: 310, unit: "ea" },
    { sku: "ETC-PD-DROP", desc: "Prodigy drop box, 8-circuit", cost: 430, price: 640, unit: "ea" },
  ],
  labor: [
    { sku: "LAB-ENG", desc: "Engineering & stamped drawings", cost: 90, price: 150, unit: "hr" },
  ],
};

/** Generic suggestions for new/unknown systems. */
export const GENERIC_SUGGEST: SuggestPart[] = [
  { sku: "GEN-FIXT",  desc: "Fixture / device (generic)",     cost: 140, price: 210, unit: "ea" },
  { sku: "GEN-CABLE", desc: "Cable & connectors allowance",   cost: 90,  price: 140, unit: "lot" },
  { sku: "GEN-HW",    desc: "Mounting hardware allowance",    cost: 60,  price: 95,  unit: "lot" },
  { sku: "GEN-LAB",   desc: "Installation labor",             cost: 65,  price: 95,  unit: "hr" },
];

/** The prototype's starting sections — used when the quote has no saved spec. */
export function demoSections(): SpecSection[] {
  return [
    { id: "rig", name: "Rigging — Counterweight System", kind: "materials", mfr: "JR Clancy", freightPct: 6, items: [
      { id: 1, sku: "CL-SPL-26", desc: "Single-purchase line set, complete, 26′-0″ batten", qty: 22, unit: "ea", cost: 1439, price: 2180 },
      { id: 2, sku: "CL-HB3", desc: "Head block, 3-groove, 8″ sheave", qty: 22, unit: "ea", cost: 469, price: 680 },
      { id: 3, sku: "CL-CW24", desc: "Counterweight brick, 24 lb cast iron", qty: 480, unit: "ea", cost: 26, price: 36 },
      { id: 4, sku: "CL-RL2", desc: "Rope lock, double, hardened", qty: 22, unit: "ea", cost: 126, price: 210 },
    ]},
    { id: "soft", name: "Soft Goods & Drapery", kind: "materials", mfr: "Rose Brand", freightPct: 5, items: [
      { id: 5, sku: "RB-MV-MN", desc: "Main curtain, 25 oz Memorable Velour, 50% fullness, pleated", qty: 1, unit: "set", cost: 9176, price: 14800 },
      { id: 6, sku: "RB-BRDR", desc: "Borders, 16 oz Encore Velour, black", qty: 6, unit: "ea", cost: 667, price: 1150 },
      { id: 7, sku: "RB-LEG", desc: "Legs, 16 oz Encore Velour, black", qty: 8, unit: "ea", cost: 568, price: 980 },
    ]},
    { id: "hoist", name: "Motorized Hoists & Control", kind: "materials", mfr: "ETC Prodigy", freightPct: 4, items: [
      { id: 9, sku: "ETC-PD-HOIST", desc: "Prodigy P1 hoist, 1,400 lb, variable speed", qty: 8, unit: "ea", cost: 3815, price: 5450 },
      { id: 10, sku: "ETC-PD-CTRL", desc: "Foundation control console, 24-axis", qty: 1, unit: "ea", cost: 8576, price: 12800 },
      { id: 11, sku: "ETC-PD-EPK", desc: "Emergency stop & perimeter package", qty: 1, unit: "lot", cost: 3136, price: 4900 },
    ]},
    { id: "labor", name: "Labor — Installation & Commissioning", kind: "labor", mfr: "", freightPct: 0, items: [
      { id: 12, sku: "LAB-RIG", desc: "Rigging installation crew (4)", qty: 320, unit: "hr", cost: 62, price: 95 },
      { id: 13, sku: "LAB-SG", desc: "Soft goods hang & trim", qty: 80, unit: "hr", cost: 55, price: 85 },
      { id: 14, sku: "LAB-PM", desc: "Project management & commissioning", qty: 60, unit: "hr", cost: 72, price: 115 },
    ]},
  ];
}
