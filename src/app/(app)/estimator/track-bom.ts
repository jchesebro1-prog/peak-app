import { DEFAULT_TRIM_FT, trackLengthFt, trackQuantities, type TrackConfig } from "@/lib/track-engine";
import {
  TRACK_OPERATION_LABELS,
  TRACK_ROLE_NAMES,
  isCordOperated,
  roleSku,
  type TrackRole,
  type TrackSeries,
} from "@/lib/track-series";
import { round2 } from "./pricing";
import { catalogAddPrice, seedMarginOf } from "./tier-reprice";
import type { CurtainDraft, SpecItem, SpecSection, TrackDraft, TrackPart } from "./types";

/**
 * #274 §3 — pricing a configured track and the one estimate line it becomes.
 * Pure: the engine (src/lib/track-engine.ts) says how many of each role; each
 * role resolves to its series' catalog part in `parts` (the live catalog as
 * the Estimator page read it); every component is priced exactly as a part
 * added from the catalog picker is (`catalogAddPrice` — cost at the tier
 * seed, else list), and the line sells for the sum. When every part has a
 * cost that sum is precisely the tier seed on the line's cost, so the line
 * is an ordinary tier-seeded line to #254's tier re-price and #266's Copy.
 *
 * A role the engine emits a quantity for whose series part is unmapped — or
 * whose SKU is no longer in the catalog — blocks the line and names the role.
 */

export type TrackBomRow = {
  role: TrackRole;
  /** Short role name ("Carrier"). */
  label: string;
  /** "" when the role has no (live) part. */
  sku: string;
  desc: string;
  qty: number;
  unit: string;
  /** Unit cost / unit sell (catalogAddPrice). 0 when missing. */
  cost: number;
  price: number;
  /** qty × unit sell. */
  ext: number;
  missing: boolean;
};

export type TrackBom = {
  rows: TrackBomRow[];
  /** Blocking problems — any one keeps the line from being added. */
  errors: string[];
  /** Line cost / sell (the whole lot, every identical track). */
  cost: number;
  price: number;
  /** Length of ONE track (run + bi-parting overlap), ft; 0 when unknown. */
  trackLengthFt: number;
};

export const TRACK_SERIES_GONE = "This series no longer exists.";

/** Where every role's part is mapped — named in every "no part" error. */
export const TRACK_SERIES_HOME = "Estimating Rules → Track series";

const MOUNT_ROLES: ReadonlySet<TrackRole> = new Set(["battenClamp", "ceilingHanger"]);

function partOf(parts: ReadonlyMap<string, TrackPart> | Record<string, TrackPart>, sku: string): TrackPart | undefined {
  if (!sku) return undefined;
  if (parts instanceof Map) return parts.get(sku);
  const rec = parts as Record<string, TrackPart>;
  return Object.prototype.hasOwnProperty.call(rec, sku) ? rec[sku] : undefined;
}

/** "40'", "12.5'" — feet, trailing zeros dropped. */
export function fmtFt(n: number): string {
  return (Math.round(n * 100) / 100).toString() + "'";
}

/**
 * The quantities, parts and money for one configuration. `series` null =
 * the line's series was deleted (the only error then). Rows are listed even
 * when a part is missing, so the modal's parts table shows which role.
 */
export function trackBom(
  config: TrackConfig,
  series: TrackSeries | null | undefined,
  parts: ReadonlyMap<string, TrackPart> | Record<string, TrackPart>,
  tierMargin: number | null | undefined
): TrackBom {
  if (!series) return { rows: [], errors: [TRACK_SERIES_GONE], cost: 0, price: 0, trackLengthFt: 0 };
  const q = trackQuantities(config, series);
  if (q.errors.length) return { rows: [], errors: q.errors, cost: 0, price: 0, trackLengthFt: 0 };
  const m = seedMarginOf(tierMargin);
  const errors: string[] = [];
  let cost = 0;
  let costed = 0; // Σ cost × qty of parts that have a cost (sold at the seed)
  let listed = 0; // Σ list × qty of parts with no cost (sold at list)
  const rows = q.rows.map((r): TrackBomRow => {
    const name = TRACK_ROLE_NAMES[r.role];
    // #291: the engine names the stick it chose; every other role reads the series map.
    const label = r.role === "track" && r.lengthFt ? `${name} (${fmtFt(r.lengthFt)} stick)` : name;
    const sku = r.sku || roleSku(series, r.role);
    const part = partOf(parts, sku);
    if (!part) {
      errors.push(`${series.name} has no part for ${name} — map it in ${TRACK_SERIES_HOME}.`);
      return { role: r.role, label, sku: "", desc: sku ? `${sku} — no longer in the catalog` : "No part mapped", qty: r.qty, unit: "", cost: 0, price: 0, ext: 0, missing: true };
    }
    const unitCost = Number(part.cost) || 0;
    const unitList = Number(part.list) || 0;
    const price = catalogAddPrice(unitCost, unitList, tierMargin);
    cost += unitCost * r.qty;
    if (unitCost > 0) costed += unitCost * r.qty;
    else listed += unitList * r.qty;
    return { role: r.role, label, sku: part.sku, desc: part.desc || label, qty: r.qty, unit: part.unit || "ea", cost: unitCost, price, ext: round2(price * r.qty), missing: false };
  });
  const price = errors.length ? 0 : round2(costed / (1 - m) + listed);
  if (!errors.length && !(price > 0)) errors.push(`${series.name}'s parts have no cost or price in the catalog.`);
  return { rows, errors, cost: errors.length ? 0 : cost, price, trackLengthFt: trackLengthFt(config, series) };
}

/** "Main drape track — ADC 280 bi-parting track, 40' run, curved R12'" (+ " (2 tracks)"). */
export function trackLineDesc(config: TrackConfig, series: Pick<TrackSeries, "name">): string {
  const label = (config.label || "").trim() || "Track";
  let desc = `${label} — ${series.name} ${TRACK_OPERATION_LABELS[config.operation].toLowerCase()} track, ${fmtFt(config.runFt)} run`;
  if (config.curved && config.radiusFt) desc += `, curved R${fmtFt(config.radiusFt)}`;
  if (config.qty > 1) desc += ` (${config.qty} tracks)`;
  return desc;
}

/** A clean copy of a config — only the fields that apply, no undefined keys. */
export function cleanTrackConfig(c: TrackConfig): TrackConfig {
  const out: TrackConfig = { seriesId: c.seriesId, operation: c.operation, runFt: c.runFt, curved: !!c.curved, mounting: c.mounting, qty: c.qty };
  if (out.curved && c.radiusFt != null) out.radiusFt = c.radiusFt;
  if (isCordOperated(c.operation) && c.trimFt != null) out.trimFt = c.trimFt;
  if (c.carrierSpacingIn != null) out.carrierSpacingIn = c.carrierSpacingIn;
  if (c.hangerSpacingFt != null) out.hangerSpacingFt = c.hangerSpacingFt;
  const label = (c.label || "").trim();
  if (label) out.label = label;
  return out;
}

export type TrackLineResult = { ok: true; item: Omit<SpecItem, "id">; bom: TrackBom } | { ok: false; errors: string[]; bom: TrackBom };

/**
 * The estimate line (spec §3): one lot, cost/sell = the parts' sums, the
 * priced parts as `components` (the fixture BOM field, so the PM parts list
 * explodes them), the inputs as `track` (so it reopens), `manufacturer` from
 * the series. Refused while the BOM has any blocking error.
 */
export function trackLine(
  config: TrackConfig,
  series: TrackSeries | null | undefined,
  parts: ReadonlyMap<string, TrackPart> | Record<string, TrackPart>,
  tierMargin: number | null | undefined
): TrackLineResult {
  const bom = trackBom(config, series, parts, tierMargin);
  if (!series || bom.errors.length) return { ok: false, errors: bom.errors, bom };
  const components: NonNullable<SpecItem["components"]> = bom.rows.map((r) => ({
    sku: r.sku,
    label: r.label,
    role: MOUNT_ROLES.has(r.role) ? "mount" : "other",
    qty: r.qty,
    unit: r.unit,
    cost: r.cost,
    price: r.price,
  }));
  const item: Omit<SpecItem, "id"> = {
    sku: "TRK-" + series.id.toUpperCase(),
    desc: trackLineDesc(config, series),
    qty: 1,
    unit: "lot",
    cost: bom.cost,
    price: bom.price,
    components,
    track: cleanTrackConfig(config),
  };
  if (series.manufacturer) item.manufacturer = series.manufacturer;
  return { ok: true, item, bom };
}

/**
 * Update track (#274 §4): the line `lineId` replaced IN PLACE by `item` —
 * same id and position (and `lineOrder`), its customer comment, internal
 * note and optional flag kept (the modal edits none of them); price edits
 * are replaced by today's catalog prices. A line no longer there is
 * appended instead. Pure.
 */
export function replaceTrackLine(sec: SpecSection, lineId: number, item: Omit<SpecItem, "id">): SpecSection {
  const at = sec.items.findIndex((it) => it.id === lineId);
  if (at < 0) return { ...sec, items: [...sec.items, { ...item, id: lineId }] };
  const old = sec.items[at];
  const next: SpecItem = { ...item, id: old.id };
  if (typeof old.lineOrder === "number") next.lineOrder = old.lineOrder;
  if (old.comment) next.comment = old.comment;
  if (old.internalNote) next.internalNote = old.internalNote;
  if (old.option) next.option = old.option;
  const items = sec.items.slice();
  items[at] = next;
  return { ...sec, items };
}

/* ---------------- the form ---------------- */

/** Blank → NaN (the engine names the field); otherwise Number(). */
function numOf(s: string): number {
  const t = (s ?? "").trim();
  return t === "" ? NaN : Number(t);
}

function optionalNum(s: string): number | undefined {
  const t = (s ?? "").trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** The form → the config the engine prices and the line stores. */
export function trackConfigFromDraft(d: TrackDraft): TrackConfig {
  const qtyText = (d.qty ?? "").trim();
  const c: TrackConfig = {
    seriesId: d.seriesId,
    operation: d.operation,
    runFt: numOf(d.run),
    curved: !!d.curved,
    mounting: d.mounting,
    qty: qtyText === "" ? 1 : Number(qtyText),
  };
  if (d.curved) c.radiusFt = numOf(d.radius);
  if (isCordOperated(d.operation)) {
    const trim = optionalNum(d.trim);
    if (trim !== undefined) c.trimFt = trim;
  }
  const carrier = optionalNum(d.carrierSpacing);
  if (carrier !== undefined && carrier > 0) c.carrierSpacingIn = carrier;
  const hanger = optionalNum(d.hangerSpacing);
  if (hanger !== undefined && hanger > 0) c.hangerSpacingFt = hanger;
  const label = (d.label || "").trim();
  if (label) c.label = label;
  return c;
}

const str = (n: number | undefined) => (n != null && Number.isFinite(n) ? String(n) : "");

/** A stored line's config back into the form (reopen). */
export function trackDraftFromConfig(c: TrackConfig): TrackDraft {
  return {
    seriesId: c.seriesId,
    operation: c.operation,
    curved: !!c.curved,
    radius: str(c.radiusFt),
    run: str(c.runFt),
    mounting: c.mounting,
    trim: str(c.trimFt ?? DEFAULT_TRIM_FT),
    qty: str(c.qty) || "1",
    label: c.label || "",
    carrierSpacing: str(c.carrierSpacingIn),
    hangerSpacing: str(c.hangerSpacingFt),
  };
}

/** Active series, by name — the modal's list. `keepId` (a reopened line's
 *  series) stays listed even when inactive. */
export function selectableTrackSeries(all: readonly TrackSeries[], keepId?: string): TrackSeries[] {
  return all.filter((s) => s.active || (!!keepId && s.id === keepId));
}

/** A new track's form: the first active series, bi-parting, straight, batten, trim 20', one track. */
export function freshTrackDraft(all: readonly TrackSeries[]): TrackDraft {
  const first = selectableTrackSeries(all)[0];
  return {
    seriesId: first?.id || "",
    operation: "biparting",
    curved: false,
    radius: "",
    run: "",
    mounting: "batten",
    trim: String(DEFAULT_TRIM_FT),
    qty: "1",
    label: "",
    carrierSpacing: "",
    hangerSpacing: "",
  };
}

/** The spacing a blank field falls back to — shown pre-filled in the collapsed Spacing row. */
export function spacingDefaults(series: Pick<TrackSeries, "carrierSpacingIn" | "hangerSpacingFt"> | null | undefined): { carrier: string; hanger: string } {
  return { carrier: series ? String(series.carrierSpacingIn) : "", hanger: series ? String(series.hangerSpacingFt) : "" };
}

/* ---------------- Add track from a curtain (spec §4) ---------------- */

export type CurtainTrackPrefill = Pick<TrackDraft, "operation" | "run" | "label">;

/**
 * What a curtain pre-fills on its track: Bi-parting when the curtain qty is
 * 2, else One-way; run = width × qty for bi-parting, else width; label =
 * curtain name + " track". (Mounting Batten is the fresh draft's own.)
 */
export function curtainTrackPrefill(c: Pick<CurtainDraft, "name" | "qty" | "width">): CurtainTrackPrefill {
  const qty = Math.max(1, parseInt(c.qty, 10) || 1);
  const width = parseFloat(c.width) || 0;
  const operation = qty === 2 ? "biparting" : "oneway";
  const run = width > 0 ? String(Math.round((operation === "biparting" ? width * qty : width) * 100) / 100) : "";
  const name = (c.name || "").trim();
  return { operation, run, label: name ? name + " track" : "" };
}

/** A curtain's track form: a fresh draft (Batten) with the curtain's pre-fills. */
export function curtainTrackDraft(c: Pick<CurtainDraft, "name" | "qty" | "width">, all: readonly TrackSeries[]): TrackDraft {
  return { ...freshTrackDraft(all), mounting: "batten", ...curtainTrackPrefill(c) };
}

/**
 * The curtain changed: every pre-filled field the user hasn't touched (still
 * equal to the previous pre-fill) follows to the new one; anything typed is
 * kept.
 */
export function followCurtainPrefill(d: TrackDraft, prev: CurtainTrackPrefill, next: CurtainTrackPrefill): TrackDraft {
  const out = { ...d };
  if (d.operation === prev.operation) out.operation = next.operation;
  if (d.run === prev.run) out.run = next.run;
  if (d.label === prev.label) out.label = next.label;
  return out;
}
