/**
 * System Status — aggregated warning list for the Grid workspace status pane.
 * Pure rules engine with no side effects.
 */

export type StatusLevel = "error" | "warn" | "info";
export type StatusFix = "calibrate" | "map" | "upload" | null;

export interface StatusItem {
  key: string;
  level: StatusLevel;
  text: string;
  fix: StatusFix;
}

export interface SystemStatusInput {
  err: string | null;
  hasSheet: boolean;
  calibrated: boolean;
  page: number;
  needsPart: number;
  hiddenUnmapped: number;
  tierFallback: string[];
  unmeasuredWires: number;
  hasWires: boolean;
}

/**
 * Generate a list of status warnings for a design, in fixed order.
 */
export function systemStatus(i: SystemStatusInput): StatusItem[] {
  const items: StatusItem[] = [];

  // 1. Error: a system error
  if (i.err) {
    items.push({ key: "err", level: "error", text: i.err, fix: null });
  }

  // 2. Upload: no plan sheet (short-circuit: calibration warning comes ONLY if there IS a sheet)
  if (!i.hasSheet) {
    items.push({ key: "sheet", level: "warn", text: "Upload a plan sheet to start.", fix: "upload" });
    return items; // No other rules apply if there's no sheet
  }

  // 3. Calibration: page not calibrated
  if (!i.calibrated) {
    const level = i.hasWires ? "warn" : "info";
    items.push({
      key: "cal",
      level,
      text: `Page ${i.page} isn't calibrated — wire lengths and snap need a scale.`,
      fix: "calibrate",
    });
  }

  // 4. Incomplete: items need a part
  if (i.needsPart > 0) {
    const s = i.needsPart === 1 ? "" : "s";
    const needs = i.needsPart === 1 ? "s" : "";
    items.push({
      key: "needs",
      level: "warn",
      text: `Incomplete — ${i.needsPart} item${s} need${needs} a part.`,
      fix: "map",
    });
  }

  // 5. Wires: unmeasured wires
  if (i.unmeasuredWires > 0) {
    const s = i.unmeasuredWires === 1 ? "" : "s";
    items.push({
      key: "wires",
      level: "warn",
      text: `${i.unmeasuredWires} wire run${s} can't be measured (page scale removed).`,
      fix: "calibrate",
    });
  }

  // 6. Tier fallback: lines quoted at list price
  if (i.tierFallback.length > 0) {
    const n = i.tierFallback.length;
    const s = n === 1 ? "" : "s";
    items.push({
      key: "tier",
      level: "info",
      text: `${n} line${s} quoted at list price (no usable cost).`,
      fix: null,
    });
  }

  // 7. Unmapped: unmapped parts hidden from Library
  if (i.hiddenUnmapped > 0) {
    const n = i.hiddenUnmapped;
    const s = n === 1 ? "" : "s";
    items.push({
      key: "unmapped",
      level: "info",
      text: `${n} unmapped part${s} hidden from the Library.`,
      fix: "map",
    });
  }

  return items;
}
