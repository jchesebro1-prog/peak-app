/* Markup parity fixtures (#367) — inputs in MARGIN terms. The capture (Task 2) runs them through the margin-era
   engines; the harness (scripts/test-markup.ts markupParityChecks) converts each margin with marginToMarkup and runs
   the markup engines. Data only — no engine imports, so this file compiles before and after the switch. */
export const CASE_COSTS = [0.01, 1, 9.99, 100, 333.33, 1234.56, 99999.99] as const;
export const CASE_MARGINS = [0.05, 0.1, 0.15, 0.2, 0.22, 0.27, 0.3, 0.35] as const;

const flameRates = { mileageRate: 1, laborRate: 75, curtainMinutes: 5, baseFee: 150, margin: 0.3, travelRoundMin: 15 };
export const FLAME_CASES = [
  { id: "flame-near", opts: { venues: [{ id: "trv-near", label: "Near", curtains: 12, oneWayMiles: 100, oneWayMin: 120 }] }, rates: flameRates },
  { id: "flame-far", opts: { venues: [{ id: "trv-far", label: "Far", curtains: 120, oneWayMiles: 500, oneWayMin: 480 }] }, rates: flameRates },
  { id: "flame-gold", opts: { venues: [{ id: "trv-near", label: "Near", curtains: 40, oneWayMiles: 30, oneWayMin: 40 }] }, rates: { ...flameRates, margin: 0.2 } },
  { id: "flame-basefee", opts: { venues: [{ id: "trv-tiny", label: "Tiny", curtains: 1, oneWayMiles: 2, oneWayMin: 5 }] }, rates: flameRates },
  { id: "flame-typed", opts: { venues: [{ id: "trv-near", label: "Near", curtains: 12, oneWayMiles: 100, oneWayMin: 120 }], priceOverride: 1000 }, rates: flameRates },
];

const repairRates = { laborRate: 75, mileageRate: 1, minCallout: 350, partsMargin: 0.3, margin: 0.3, emergencyMult: 1.5, travelRoundMin: 15 };
export const REPAIR_CASES = [
  { id: "repair-near", opts: { venues: [{ label: "Near", oneWayMiles: 60, oneWayMin: 70 }], laborHours: 4 }, rates: repairRates },
  { id: "repair-far", opts: { venues: [{ label: "Far", oneWayMiles: 500, oneWayMin: 480 }], laborHours: 24 }, rates: repairRates },
  { id: "repair-parts", opts: { venues: [{ label: "Near", oneWayMiles: 60, oneWayMin: 70 }], laborHours: 6, parts: [{ desc: "Cable", qty: 4, cost: 87.5 }] }, rates: { ...repairRates, partsMargin: 0.25 } },
  { id: "repair-callout", opts: { venues: [{ label: "Tiny", oneWayMiles: 2, oneWayMin: 5 }], laborHours: 0.5 }, rates: repairRates },
  { id: "repair-emergency", opts: { venues: [{ label: "Near", oneWayMiles: 60, oneWayMin: 70 }], laborHours: 4, emergency: true }, rates: repairRates },
  { id: "repair-callout-parts", opts: { venues: [{ label: "Tiny", oneWayMiles: 2, oneWayMin: 5 }], laborHours: 0.5, parts: [{ desc: "Cable", qty: 4, cost: 87.5 }] }, rates: repairRates },
  { id: "repair-lift", opts: { venues: [{ label: "Near", oneWayMiles: 60, oneWayMin: 70 }], laborHours: 4, lift: { count: 1, rate: 450 } }, rates: repairRates },
];

const inspRates = { laborRate: 75, mileageRate: 1, lineSetMinutes: 15, baseHours: 2, level2Mult: 1.75, minFee: 650, margin: 0.3, travelRoundMin: 15 };
export const INSPECTION_CASES = [
  { id: "insp-near", opts: { venues: [{ id: "trv-i1", label: "Near", lineSets: 20, oneWayMiles: 60, oneWayMin: 70 }] }, rates: inspRates },
  { id: "insp-far", opts: { venues: [{ id: "trv-i2", label: "Far", lineSets: 40, oneWayMiles: 500, oneWayMin: 480 }] }, rates: inspRates },
  { id: "insp-minfee", opts: { venues: [{ id: "trv-i3", label: "Tiny", lineSets: 1, oneWayMiles: 2, oneWayMin: 5 }] }, rates: inspRates },
  { id: "insp-l2", opts: { level: 2, venues: [{ id: "trv-i1", label: "Near", lineSets: 20, oneWayMiles: 60, oneWayMin: 70 }] }, rates: { ...inspRates, margin: 0.15 } },
];

/** A labor draft with no mobilizations: cost = shop hrs × SHP-IN + misc. `margin` is a margin percent string. */
export const LABOR_DRAFT = { discipline: "RIG", margin: "30", mobs: [], pmHrs: "", pmAuto: true, shopHrs: "10", drfHrs: "", drfAuto: true, misc: "1000" };
export const LABOR_DRAFT_22 = { ...LABOR_DRAFT, margin: "22" };
export const laborRate = (sku: string) => (sku === "SHP-IN" ? 85 : sku === "SHP-PM" ? 95 : 70);

export const CURTAIN_CASES = [
  { id: "curtain-30", spec: { width: "40", height: "22", fullness: "50" }, rates: { fabricRate: 2.75, sewingPct: 10 }, margin: 0.3 },
  { id: "curtain-20", spec: { width: "12.5", height: "18", fullness: "100" }, rates: { fabricRate: 4.1, sewingPct: 10 }, margin: 0.2 },
];

/** Two systems priced at 30 % and 22 % margin, one with freight and a typed sell. */
export const SECTIONS = [
  { id: "s1", name: "Rigging", kind: "materials", mfr: "", freightPct: 3, items: [
    { id: 1, sku: "A", desc: "A", qty: 2, unit: "ea", cost: 100, price: 142.86 },
    { id: 2, sku: "B", desc: "B", qty: 5, unit: "ea", cost: 37.4, price: 53.43 },
  ] },
  { id: "s2", name: "Lighting", kind: "materials", mfr: "", freightPct: 0, sellOverride: 5000, items: [
    { id: 3, sku: "C", desc: "C", qty: 10, unit: "ea", cost: 300, price: 384.62 },
  ] },
];
