/**
 * #328 B1 — cable outside diameters. A catalog part's `cableOdIn` (inches) is
 * what the conduit-fill math (B2) sums; this module holds the one cleaner for
 * that value and the researched pre-fill table behind the Riser data sheet's
 * Cables tab and the part editor's hint.
 *
 * `CABLE_OD_SUGGESTIONS` is built ONLY from rows of
 * docs/specs-seed/cable-od-2026-10-10.json that resolved to a datasheet value
 * (each carries its datasheet URL as `source`). A cable the research could
 * not verify (Belden 1872A, ETC EchoConnect aux power / ESD ground singles,
 * ProPlex PC224P-PLN and PC4P) has NO row here — it stays blank, never guessed.
 *
 * Pure: no store/db imports.
 */

/** Largest outside diameter a part may carry, inches (a trunk, not a hookup wire). */
export const CABLE_OD_MAX_IN = 3.0;

/** A positive number ≤ CABLE_OD_MAX_IN rounded to 3 decimals; null for anything else (blank, text, 0, negative, too big). */
export function cleanCableOd(v: unknown): number | null {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  const t = typeof v === "number" ? v : typeof v === "string" && /^\s*\d*\.?\d+\s*$/.test(v) ? Number(v) : NaN;
  if (!Number.isFinite(t)) return null;
  const r = Math.round(t * 1000) / 1000;
  return r > 0 && r <= CABLE_OD_MAX_IN ? r : null;
}

/** How a cable OD prints in a cell or a field: 0.19, 0.274 — no trailing zeros. */
export const formatCableOd = (n: number) => String(Number(n.toFixed(3)));

export type CableOdSuggestion = {
  /** Manufacturer names a part may carry for this cable (matched without case, spaces or punctuation). */
  mfrs: string[];
  /** Model numbers the cable goes by (a part's Model #, MFR P/N, SKU text or description token must equal one). */
  models: string[];
  odIn: number;
  /** The datasheet the value was read from. */
  source: string;
};

export const CABLE_OD_SUGGESTIONS: readonly CableOdSuggestion[] = [
  { mfrs: ["Belden"], models: ["1583A"], odIn: 0.19, source: "https://catalog.belden.com/techdata/EN/1583A_techdata.pdf" }, // Belden 1583A
  { mfrs: ["Belden"], models: ["1585A"], odIn: 0.19, source: "https://catalog.belden.com/techdata/EN/1585A_techdata.pdf" }, // Belden 1585A
  { mfrs: ["Belden"], models: ["1700A"], odIn: 0.202, source: "https://catalog.belden.com/techdata/EN/1700A_techdata.pdf" }, // Belden 1700A
  { mfrs: ["Belden"], models: ["1701A"], odIn: 0.195, source: "https://catalog.belden.com/techdata/EN/1701A_techdata.pdf" }, // Belden 1701A
  { mfrs: ["Belden"], models: ["2412"], odIn: 0.224, source: "https://catalog.belden.com/techdata/EN/2412_techdata.pdf" }, // Belden 2412
  { mfrs: ["Belden"], models: ["2413"], odIn: 0.224, source: "https://catalog.belden.com/techdata/EN/2413_techdata.pdf" }, // Belden 2413
  { mfrs: ["Belden"], models: ["7814A"], odIn: 0.23, source: "https://catalog.belden.com/techdata/EN/7814A_techdata.pdf" }, // Belden 7814A
  { mfrs: ["Belden"], models: ["7929A"], odIn: 0.275, source: "https://catalog.belden.com/techdata/EN/7929A_techdata.pdf" }, // Belden 7929A
  { mfrs: ["Belden"], models: ["9841"], odIn: 0.232, source: "https://catalog.belden.com/techdata/EN/9841_techdata.pdf" }, // Belden 9841
  { mfrs: ["Belden"], models: ["9842"], odIn: 0.34, source: "https://catalog.belden.com/techdata/EN/9842_techdata.pdf" }, // Belden 9842
  { mfrs: ["Belden"], models: ["9729"], odIn: 0.266, source: "https://catalog.belden.com/techdata/EN/9729_techdata.pdf" }, // Belden 9729
  { mfrs: ["Belden"], models: ["9829"], odIn: 0.291, source: "https://catalog.belden.com/techdata/EN/9829_techdata.pdf" }, // Belden 9829
  { mfrs: ["Belden"], models: ["82842"], odIn: 0.273, source: "https://catalog.belden.com/techdata/EN/82842_techdata.pdf" }, // Belden 82842
  { mfrs: ["Belden"], models: ["8471"], odIn: 0.274, source: "https://catalog.belden.com/techdata/EN/8471_techdata.pdf" }, // Belden 8471
  { mfrs: ["Belden"], models: ["8461"], odIn: 0.234, source: "https://catalog.belden.com/techdata/EN/8461_techdata.pdf" }, // Belden 8461
  { mfrs: ["Belden"], models: ["8473"], odIn: 0.356, source: "https://catalog.belden.com/techdata/EN/8473_techdata.pdf" }, // Belden 8473
  { mfrs: ["Belden"], models: ["8760"], odIn: 0.222, source: "https://catalog.belden.com/techdata/EN/8760_techdata.pdf" }, // Belden 8760
  { mfrs: ["Belden"], models: ["8761"], odIn: 0.175, source: "https://catalog.belden.com/techdata/EN/8761_techdata.pdf" }, // Belden 8761
  { mfrs: ["Southwire"], models: ["R50003-1B", "13060"], odIn: 0.174, source: "https://www.southwire.com/wire-cable/low-voltage-cable/multi-conductor-security-riser-unshielded/p/R50003-1B" }, // Southwire R50003-1B (spec 13060)
  { mfrs: ["ETC"], models: ["EchoConnect standard cable"], odIn: 0.274, source: "https://support.etcconnect.com/ETC/FAQ/Cable_Cross_Database_Filter_Search" }, // ETC EchoConnect standard cable (data)
  { mfrs: ["TMB", "ProPlex"], models: ["PC224P"], odIn: 0.285, source: "https://tmb.com/docs/proplex/dmx/pdf/ProPlexP-LTR-web.pdf" }, // TMB ProPlex PC224P
  { mfrs: ["TMB", "ProPlex"], models: ["PC224T"], odIn: 0.32, source: "https://tmb.com/docs/proplex/dmx/pdf/ProPlex-PC224T-LTR-web.pdf" }, // TMB ProPlex PC224T
  { mfrs: ["TMB", "ProPlex"], models: ["PC244T"], odIn: 0.315, source: "https://tmb.com/docs/proplex/dmx/pdf/ProPlex-PC244T-LTR-web.pdf" }, // TMB ProPlex PC244T
  { mfrs: ["TMB", "ProPlex"], models: ["PC244TPB"], odIn: 0.245, source: "https://tmb.com/docs/proplex/dmx/pdf/ProPlex-PC244TPB-LTR-web.pdf" }, // TMB ProPlex PC244TPB
  { mfrs: ["TMB", "ProPlex"], models: ["PC226T"], odIn: 0.33, source: "https://tmb.com/docs/proplex/dmx/pdf/ProPlex-PC226T-LTR-web.pdf" }, // TMB ProPlex PC226T
  { mfrs: ["TMB", "ProPlex"], models: ["PCLP1PT"], odIn: 0.2, source: "https://tmb.com/docs/proplex/arch-node/ProPlex-Arch-Node-LTR-web.pdf" }, // TMB ProPlex PCLP1PT
  { mfrs: ["TMB", "ProPlex"], models: ["PCLP1PTPB"], odIn: 0.198, source: "https://tmb.com/docs/proplex/arch-node/ProPlex-Arch-Node-LTR-web.pdf" }, // TMB ProPlex PCLP1PTPB
  { mfrs: ["TMB", "ProPlex"], models: ["PCLP2PT"], odIn: 0.315, source: "https://tmb.com/docs/proplex/arch-node/ProPlex-Arch-Node-LTR-web.pdf" }, // TMB ProPlex PCLP2PT
  { mfrs: ["TMB", "ProPlex"], models: ["PCLP2PTPB"], odIn: 0.315, source: "https://tmb.com/docs/proplex/arch-node/ProPlex-Arch-Node-LTR-web.pdf" }, // TMB ProPlex PCLP2PTPB
  { mfrs: ["TMB", "ProPlex"], models: ["PCCAT5EUTPP", "PCAT5EUTPP"], odIn: 0.244, source: "https://tmb.com/docs/proplex/cat5e/pdf/ProPlex-PCCAT5EUTPP-LTR-web.pdf" }, // TMB ProPlex PCCAT5EUTPP (PCAT5EUTPP)
];

/** Lower-case letters and digits only: "Belden Inc." → "beldeninc", "R50003-1B" → "r500031b". */
export const normCableKey = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export type CableOdPartLike = {
  sku: string;
  /** A catalog part's brand is `mfr`; `manufacturer` is accepted too (the Grid-library shape). */
  manufacturer?: string;
  mfr?: string;
  manufacturerModelNumber?: string;
  manufacturerPartNumber?: string;
  desc?: string;
};

const mfrMatches = (partMfr: string, entry: CableOdSuggestion) => entry.mfrs.some((m) => {
  const e = normCableKey(m);
  return !!e && (partMfr === e || partMfr.includes(e) || (partMfr.length >= 3 && e.includes(partMfr)));
});

/** Whitespace/comma/paren/slash-separated tokens of a text, normalized, plus the whole text as one key. */
function keysOf(text: string): Set<string> {
  const out = new Set<string>();
  const whole = normCableKey(text);
  if (whole) out.add(whole);
  for (const t of text.split(/[\s,;()/]+/)) {
    const k = normCableKey(t);
    if (k) out.add(k);
  }
  return out;
}

/**
 * The researched diameter for a part, or null. A model match is by the part's
 * Model #, MFR P/N or the text after the SKU's `Brand:`; it also requires the
 * manufacturer to match when the part has one. A match from the description
 * ("Belden 1583A 1000ft") additionally needs the manufacturer to be positively
 * known — on the part, or named in the description. A model that is only a
 * prefix of the part's (PC224P vs PC224P-PLN) never matches. If more than one
 * table row fits at the same level the answer is null — never a guess.
 */
export function suggestCableOd(part: CableOdPartLike): CableOdSuggestion | null {
  const mfr = normCableKey(part.manufacturer || part.mfr);
  const modelKeys = new Set<string>();
  for (const t of [part.manufacturerModelNumber, part.manufacturerPartNumber, part.sku.includes(":") ? part.sku.slice(part.sku.indexOf(":") + 1) : part.sku]) {
    for (const k of keysOf(String(t ?? ""))) modelKeys.add(k);
  }
  const hits = (keys: Set<string>, entryOk: (e: CableOdSuggestion) => boolean) =>
    CABLE_OD_SUGGESTIONS.filter((e) => entryOk(e) && e.models.some((m) => keys.has(normCableKey(m))));
  const byModel = hits(modelKeys, (e) => !mfr || mfrMatches(mfr, e));
  if (byModel.length) return byModel.length === 1 ? byModel[0] : null;
  const desc = String(part.desc ?? "");
  const descKeys = keysOf(desc);
  const byDesc = hits(descKeys, (e) => (mfr ? mfrMatches(mfr, e) : e.mfrs.some((m) => descKeys.has(normCableKey(m)))));
  return byDesc.length === 1 ? byDesc[0] : null;
}
