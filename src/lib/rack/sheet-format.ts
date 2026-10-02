/**
 * #296 — pure formatting for the printed rack sheets (elevation, equipment
 * schedule, power/heat). No React, no store/db imports, so the harness tests
 * every cell the sheets print. Absent = unknown: a null number prints "—",
 * and a watts- or weight-derived total with unknowns reads "At least …".
 */
import { DEFAULT_TZ } from "@/lib/venue-availability";
import { RACK_FACT_LABEL } from "./part-facts";
import { formatBtu, formatLb, formatWatts, type RackSubmittal } from "./submittal";
import { CIRCUIT_VOLTS, type RackIssue, type RackMissing } from "./types";

export const RACK_SHEET_UNKNOWN = "—";
export const RACK_SHEET_NOTE = "For submittal — not for construction.";
export type RackSheetKind = "elevation" | "schedule" | "power";
export const RACK_SHEET_KINDS: readonly RackSheetKind[] = ["elevation", "schedule", "power"];

/** `?sheet=` → a sheet kind; anything else is the elevation. */
export function parseRackSheet(v: string | undefined | null): RackSheetKind {
  return v === "schedule" || v === "power" ? v : "elevation";
}

/** A schedule number cell: up to two decimals, thousands grouped, "—" when unknown. */
export function rackCell(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : RACK_SHEET_UNKNOWN;
}

/** A text cell: blank prints "—". */
export function rackText(s: string | null | undefined): string {
  return s && s.trim() ? s : RACK_SHEET_UNKNOWN;
}

/** "Oct 2, 2026" in the app's office zone (the title block's own format). */
export function rackDateLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: DEFAULT_TZ });
}

/** The footer line every sheet prints. */
export function rackSheetFooter(companyName: string, rackLabel: string, dateLabel: string): string {
  return [companyName.trim(), `Rack submittal — ${rackLabel}`, dateLabel].filter(Boolean).join(" · ");
}

const atLeast = (unknown: number, text: string) => (unknown > 0 ? `At least ${text}` : text);

/** The power/heat sheet's totals grid, in print order. The PDU row prints only when a capacity is known. */
export function rackTotalsRows(s: RackSubmittal): Array<{ label: string; value: string }> {
  const t = s.totals;
  const w = t.unknownWatts;
  const rows = [
    { label: "RU used", value: `${t.ruUsed} of ${t.ruCount}` },
    { label: "RU free", value: String(t.ruFree) },
    { label: "RU reserved", value: String(t.ruReserved) },
    { label: "Weight", value: atLeast(t.unknownWeight, formatLb(t.weightLb)) },
    { label: "Typical power", value: atLeast(w, formatWatts(t.watts)) },
    { label: "Maximum power", value: atLeast(w, formatWatts(t.maxWatts)) },
    { label: "Heat", value: atLeast(w, formatBtu(t.btuHr)) },
    { label: `Current at ${CIRCUIT_VOLTS} V`, value: atLeast(w, `${t.amps.toFixed(1)} A`) },
  ];
  if (s.power.capacityWatts !== null) {
    rows.push({
      label: "PDU capacity",
      value: s.power.loadPct !== null ? `${formatWatts(s.power.capacityWatts)} — ${s.power.loadPct}% loaded` : formatWatts(s.power.capacityWatts),
    });
  }
  return rows;
}

/** Errors first, then warnings; each group keeps its own order. */
export function rackIssuesForSheet(issues: readonly RackIssue[]): RackIssue[] {
  return [...issues.filter((i) => i.level === "error"), ...issues.filter((i) => i.level !== "error")];
}

/** "Power amplifier (AMP-A): Weight (lb), Power (W)". */
export function rackMissingLine(m: RackMissing): string {
  const name = m.label && m.label !== m.sku ? `${m.label} (${m.sku})` : m.sku;
  return `${name}: ${m.fields.map((f) => RACK_FACT_LABEL[f]).join(", ")}`;
}
