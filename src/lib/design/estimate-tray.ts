/**
 * #314 — the Grid's "From estimate" tray. A Grid design started from an
 * Estimator quote ("Design in the Grid") opens with nothing placed; the tray
 * lists every placeable BOM line of the estimate with a count, and the
 * designer places each one by hand. Pure and client-safe: the server reads the
 * quote's CURRENT saved spec and the catalog (estimate-tray-server.ts); the
 * editor recomputes the counts from its live placements after every place.
 *
 * Rules (D-#314 tray):
 * - Lines come from materials systems only (a labor system is not equipment).
 * - Excluded, counted for the footnote: labor lines, allowances and vendor
 *   quotes, curtains (the Grid has its own curtain drop-in), a blank or
 *   placeholder SKU (CUSTOM, AI…), per-length parts (wire is drawn as a run,
 *   not placed), and — when the server says so — a SKU that is not a catalog
 *   part the Grid can place (fabric, Labor category, unknown).
 * - A line in an Alternate group, or an add-option line (`option`), lands in
 *   the separate "Alternates & options" list; everything else is "In total".
 * - Rows aggregate by RESOLVED SKU (#304 rename map, old → live), so an
 *   estimate line and a placement that name a part by two spellings count once.
 * - Placed units: the option's non-curtain placements of that SKU, a lot
 *   marker counting its `qty`. They fill the In-total need first, then the
 *   alternates' need; anything past both is `overBy` (on the In-total row
 *   when there is one).
 */

import { isPerLengthUnit, placementQty } from "./grid-bom";
import { isPlaceholderSku } from "@/lib/specs/record-keys";

export type TrayExclusion = "labor" | "allowance" | "curtain" | "per-length" | "no-part";

/** One placeable estimate line, already filtered (server → client payload). */
export type TrayLine = { sku: string; label: string; model: string; qty: number; alt: boolean };

export type TrayLinesResult = {
  lines: TrayLine[];
  /** Lines left out of the tray, for the footnote. */
  excluded: number;
  excludedBy: Partial<Record<TrayExclusion, number>>;
};

/** The server's tray payload for the editor (estimate-tray-server.ts). */
export type EstimateTrayData = TrayLinesResult & {
  quoteId: string;
  quoteNumber: string;
  /** The estimate's own builder (the Estimator). */
  href: string;
  /** The linked quote was deleted — the tray is empty and says so. */
  gone: boolean;
  /** requested SKU → live SKU, only where they differ. */
  renames: Record<string, string>;
};

export type TrayRow = {
  sku: string;
  label: string;
  model: string;
  needed: number;
  placed: number;
  remaining: number;
  /** Units placed past what the estimate asks for. */
  overBy: number;
};

export type TrayView = {
  main: TrayRow[];
  alternates: TrayRow[];
  /** Placed parts the estimate does not list at all (drawing-only extras). */
  extras: Array<{ sku: string; placed: number }>;
  totals: { needed: number; placed: number; remaining: number };
};

export const TRAY_MAX_LINES = 2000;

type Renames = ReadonlyMap<string, string> | Readonly<Record<string, string>>;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function resolver(renames: Renames | null | undefined): (sku: string) => string {
  if (!renames) return (s) => s;
  if (renames instanceof Map) return (s) => renames.get(s) ?? s;
  const rec = renames as Readonly<Record<string, string>>;
  return (s) => (Object.prototype.hasOwnProperty.call(rec, s) && typeof rec[s] === "string" && rec[s] ? rec[s] : s);
}

/** Group ids marked Alternate in the quote's `spec.groups` (read defensively). */
function alternateGroupIds(groups: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(groups)) return out;
  for (const g of groups) {
    if (g && typeof g === "object" && (g as { alternate?: unknown }).alternate === true && typeof (g as { id?: unknown }).id === "string") {
      out.add((g as { id: string }).id);
    }
  }
  return out;
}

/**
 * The tray's lines from a quote's saved `spec.sections` + `spec.groups`.
 * `placeable(sku)` — the server's catalog check, on the RESOLVED sku — may
 * reject a SKU (fabric, Labor, not a catalog part); absent = every real SKU.
 */
export function estimateTrayLines(
  sections: unknown,
  groups: unknown,
  opts: { placeable?: (sku: string) => boolean; resolve?: Renames | null } = {}
): TrayLinesResult {
  const resolve = resolver(opts.resolve);
  const altGroups = alternateGroupIds(groups);
  const lines: TrayLine[] = [];
  const excludedBy: Partial<Record<TrayExclusion, number>> = {};
  let excluded = 0;
  const skip = (why: TrayExclusion) => {
    excluded += 1;
    excludedBy[why] = (excludedBy[why] || 0) + 1;
  };
  for (const raw of Array.isArray(sections) ? sections : []) {
    if (!raw || typeof raw !== "object") continue;
    const sec = raw as { kind?: unknown; alternate?: unknown; groupId?: unknown; items?: unknown };
    if (sec.kind === "labor") continue;
    const altSection = sec.alternate === true || (typeof sec.groupId === "string" && altGroups.has(sec.groupId));
    for (const rawItem of Array.isArray(sec.items) ? sec.items : []) {
      if (!rawItem || typeof rawItem !== "object") continue;
      const it = rawItem as Record<string, unknown>;
      const qty = Math.round(Number(it.qty));
      if (!Number.isFinite(qty) || qty <= 0) continue;
      if (it.labor === true || it.laborOverhead || it.laborTravel) { skip("labor"); continue; }
      if (it.allowance === true || (typeof it.vendorQuoteId === "string" && it.vendorQuoteId)) { skip("allowance"); continue; }
      if (it.curtain === true) { skip("curtain"); continue; }
      const rawSku = str(it.sku);
      if (!rawSku || rawSku.length > 128 || isPlaceholderSku(rawSku)) { skip("no-part"); continue; }
      if (isPerLengthUnit(str(it.unit))) { skip("per-length"); continue; }
      const sku = resolve(rawSku);
      if (opts.placeable && !opts.placeable(sku)) { skip("no-part"); continue; }
      if (lines.length >= TRAY_MAX_LINES) { skip("no-part"); continue; }
      lines.push({
        sku,
        label: str(it.desc) || sku,
        model: str(it.manufacturerModelNumber) || str(it.manufacturerPartNumber),
        qty,
        alt: altSection || it.option === true,
      });
    }
  }
  return { lines, excluded, excludedBy };
}

/** The tray's rows: lines aggregated by resolved SKU, placed counts from the option's placements. */
export function trayRows(
  lines: readonly TrayLine[],
  placements: ReadonlyArray<{ partId: string; qty?: number | null; curtain?: unknown }>,
  renames?: Renames | null
): TrayView {
  const resolve = resolver(renames);
  type Acc = { sku: string; label: string; model: string; main: number; alt: number; order: number };
  const acc = new Map<string, Acc>();
  for (const l of lines) {
    const sku = resolve(l.sku);
    const q = Math.max(0, Math.round(Number(l.qty)) || 0);
    if (!sku || !q) continue;
    let a = acc.get(sku);
    if (!a) {
      a = { sku, label: l.label || sku, model: l.model || "", main: 0, alt: 0, order: acc.size };
      acc.set(sku, a);
    }
    if (l.alt) a.alt += q;
    else a.main += q;
  }
  const placed = new Map<string, number>();
  for (const pl of placements) {
    if (!pl || pl.curtain || typeof pl.partId !== "string" || !pl.partId) continue;
    const sku = resolve(pl.partId);
    placed.set(sku, (placed.get(sku) || 0) + placementQty(pl));
  }
  const main: TrayRow[] = [];
  const alternates: TrayRow[] = [];
  for (const a of [...acc.values()].sort((x, y) => x.order - y.order)) {
    let left = placed.get(a.sku) || 0;
    const mainPlaced = Math.min(left, a.main);
    left -= mainPlaced;
    const altPlaced = Math.min(left, a.alt);
    left -= altPlaced;
    const over = left;
    if (a.main > 0) main.push({ sku: a.sku, label: a.label, model: a.model, needed: a.main, placed: mainPlaced + over, remaining: a.main - mainPlaced, overBy: over });
    if (a.alt > 0) {
      const altOver = a.main > 0 ? 0 : over;
      alternates.push({ sku: a.sku, label: a.label, model: a.model, needed: a.alt, placed: altPlaced + altOver, remaining: a.alt - altPlaced, overBy: altOver });
    }
  }
  const extras = [...placed.entries()].filter(([sku]) => !acc.has(sku)).map(([sku, n]) => ({ sku, placed: n })).sort((x, y) => x.sku.localeCompare(y.sku));
  const totals = main.reduce((t, r) => ({ needed: t.needed + r.needed, placed: t.placed + Math.min(r.placed, r.needed), remaining: t.remaining + r.remaining }), { needed: 0, placed: 0, remaining: 0 });
  return { main, alternates, extras, totals };
}

const EXCLUSION_WORDS: Record<TrayExclusion, string> = {
  labor: "labor",
  allowance: "allowances",
  curtain: "curtains",
  "per-length": "wire by the foot (draw it as a run)",
  "no-part": "lines with no Grid part",
};

/** "3 lines aren't placed here: labor, curtains." — empty when nothing was left out. */
export function trayFootnote(r: Pick<TrayLinesResult, "excluded" | "excludedBy">): string {
  if (!r.excluded) return "";
  const why = (Object.keys(EXCLUSION_WORDS) as TrayExclusion[]).filter((k) => (r.excludedBy[k] || 0) > 0).map((k) => EXCLUSION_WORDS[k]);
  return `${r.excluded} line${r.excluded === 1 ? "" : "s"} ${r.excluded === 1 ? "isn't" : "aren't"} placed here${why.length ? `: ${why.join(", ")}` : ""}.`;
}
