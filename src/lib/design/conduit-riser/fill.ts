/**
 * #328 B2 — computed conduit fill. Pure: the cables in a conduit run (their
 * outside diameters, from the catalog part's `cableOdIn`) against NEC
 * Chapter 9 for EMT. It SUGGESTS a size and WARNS when the typed size is
 * overfilled; it never decides the size and never blocks a quote or a print.
 *
 * Tables (EMT only — no other raceway type is modelled):
 *  - Chapter 9 Table 4, Article 358 EMT, "Total Area 100%" in in², verified
 *    against the published reproduction at
 *    https://conduit.site/tables/chpt9-table4.php (NEC 2020/2023 values;
 *    internal diameters 0.622 … 4.334 in agree: area = π/4·ID²).
 *  - Chapter 9 Table 1 allowed fill: 1 conductor 53 %, 2 conductors 31 %,
 *    over 2 conductors 40 %.
 * A cable counts as one conductor/cable here ("each member counts once").
 */

import type { ViewRun } from "./derive";

/** EMT trade size (as printed on a run) → Table 4 total internal area, in². */
export const EMT_AREAS: readonly { size: string; area: number }[] = [
  { size: '1/2"', area: 0.304 },
  { size: '3/4"', area: 0.533 },
  { size: '1"', area: 0.864 },
  { size: '1-1/4"', area: 1.496 },
  { size: '1-1/2"', area: 2.036 },
  { size: '2"', area: 3.356 },
  { size: '2-1/2"', area: 5.858 },
  { size: '3"', area: 8.846 },
  { size: '3-1/2"', area: 11.545 },
  { size: '4"', area: 14.753 },
];

/** Chapter 9 Table 1: percent of the conduit's area the cables may fill. */
export function allowedFillPct(count: number): number {
  return count <= 1 ? 53 : count === 2 ? 31 : 40;
}

/**
 * A run's free-text size → the EMT trade size as printed in EMT_AREAS
 * (`3/4"`, `1-1/4"`), or null when it isn't an EMT trade size.
 * Accepts `3/4`, `3/4"`, `3/4 in`, `1 1/4"`, `1-1/4" EMT`, `2 inch`, Bray's `3/4"C` / `1"C`
 * and the unicode fractions `¾"`, `½"`, `1¼"`.
 */
export function normalizeEmtSize(raw: string): string | null {
  const t = String(raw ?? "")
    .toLowerCase()
    // Bray-style "3/4\"C" / "1\"C": a trailing C marks conduit.
    .replace(/(?<=[\d"\u201d\u2033])\s*c\s*$/, "")
    // Unicode fractions: ¾" → 3/4", 1½" → 1-1/2".
    .replace(/(\d)?\s*([\u00bc\u00bd\u00be])/g, (_m, whole: string | undefined, f: string) => `${whole ? `${whole}-` : ""}${f === "\u00bc" ? "1/4" : f === "\u00bd" ? "1/2" : "3/4"}`)
    .replace(/[\u2033\u201d"]/g, "")
    .replace(/emt/g, "")
    .replace(/(inches|inch|in)\b\.?/g, "")
    .replace(/[\u2010-\u2015]/g, "-")
    .trim()
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, "-");
  const hit = EMT_AREAS.find((e) => e.size.replace('"', "") === t);
  return hit ? hit.size : null;
}

export type FillMember = { cable: string; odIn: number | null | undefined };

export type RunFill =
  /** Some cable has no diameter: the sum can't be trusted. */
  | { unknown: string[] }
  | {
      count: number;
      /** Σ π·(OD/2)², in². */
      areaIn2: number;
      /** Table 1 limit for this many cables, percent. */
      allowed: number;
      /** Percent of the typed size's area; null when the size isn't an EMT trade size (suggestion only). */
      pct: number | null;
      over: boolean;
      /** Smallest EMT trade size whose allowed area holds the cables; null when even 4" is too small. */
      suggested: string | null;
    };

/** Fill for the cables in one run at its typed size; null when the run carries no cables. */
export function runFill(members: readonly FillMember[], size: string): RunFill | null {
  if (!members.length) return null;
  const missing = members.filter((m) => !(typeof m.odIn === "number" && m.odIn > 0 && Number.isFinite(m.odIn)));
  if (missing.length) return { unknown: [...new Set(missing.map((m) => m.cable))].sort() };
  const areaIn2 = members.reduce((s, m) => s + Math.PI * Math.pow((m.odIn as number) / 2, 2), 0);
  const allowed = allowedFillPct(members.length);
  const typed = normalizeEmtSize(size);
  const typedArea = typed ? EMT_AREAS.find((e) => e.size === typed)!.area : null;
  const pct = typedArea ? (areaIn2 / typedArea) * 100 : null;
  const suggested = EMT_AREAS.find((e) => e.area * (allowed / 100) >= areaIn2 - 1e-12)?.size ?? null;
  return { count: members.length, areaIn2, allowed, pct, over: pct !== null && pct > allowed + 1e-9, suggested };
}

/** The fill of a derived run, or null for a run that isn't conduit (cable management) or carries no cables. */
export function viewRunFill(vr: Pick<ViewRun, "run" | "members">): RunFill | null {
  if (vr.run.style === "cableMgmt") return null;
  return runFill(vr.members.map((m) => ({ cable: m.cable, odIn: m.odIn })), vr.run.size);
}

export const isOverfilled = (f: RunFill | null): f is Extract<RunFill, { count: number }> => !!f && "count" in f && f.over;

/** 28.4 → "28.4", 28 → "28": one decimal, no trailing zero. */
export const fmtPct = (n: number) => String(Number(n.toFixed(1)));

/** The Run panel's line, and whether it is a warning. */
export function fillLine(f: RunFill, size: string): { text: string; tone: "ok" | "warn" | "unknown" } {
  if ("unknown" in f) return { text: `Fill unknown — no diameter for ${f.unknown.join(", ")}`, tone: "unknown" };
  const cables = `${f.count} cable${f.count === 1 ? "" : "s"}`;
  if (f.over) return { text: `Overfilled — ${size.trim()} allows ${f.allowed} % for ${cables}${f.suggested ? ` · suggests ${f.suggested}` : " · larger than 4\" EMT"}`, tone: "warn" };
  const sug = f.suggested ? `suggests ${f.suggested}` : "larger than 4\" EMT";
  return { text: f.pct === null ? `Fill — ${sug} for ${cables}` : `Fill ${fmtPct(f.pct)} % · ${sug}`, tone: "ok" };
}

/** The riser page's warnings-list line for an overfilled run. */
export function overfillWarning(aLabel: string, bLabel: string, size: string, f: Extract<RunFill, { count: number }>): string {
  return `${aLabel} → ${bLabel}: ${size.trim()} is overfilled (${fmtPct(f.pct ?? 0)} %, ${f.allowed} % allowed) — ${f.suggested ? `suggests ${f.suggested}` : "larger than 4\" EMT"}`;
}
