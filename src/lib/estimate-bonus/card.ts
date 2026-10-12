/** Estimator bonuses — display logic for the Send & track card (pure). */
import type { SpecSection } from "@/app/(app)/estimator/types";
import { round2 } from "@/app/(app)/estimator/pricing";
import { isEstimatorBonusItem } from "./flags";

/** The alternates a customer may take: systems marked Alternate, in order. */
export function alternateChoices(sections: SpecSection[]): { id: string; name: string }[] {
  return sections.filter((s) => s.alternate === true).map((s) => ({ id: s.id, name: s.name || "Alternate" }));
}

/** Σ estimator-line sell over non-alternate systems and the taken alternates (same rule as buildBonusRecord). */
export function liveEstimatorBonus(sections: SpecSection[], taken: string[]): number {
  const t = new Set(taken);
  let sum = 0;
  for (const s of sections) {
    if (s.alternate === true && !t.has(s.id)) continue;
    for (const it of s.items) {
      if (it.option) continue;
      if (isEstimatorBonusItem(it)) sum += it.qty * it.price;
    }
  }
  return round2(sum);
}

/** The split row shows only for two different, non-blank people. */
export function showSplitRow(owner: string, preparedBy: string): boolean {
  const a = (owner || "").trim().toLowerCase();
  const b = (preparedBy || "").trim().toLowerCase();
  return !!a && !!b && a !== b;
}

/** Clamp a typed lead percentage to a whole number 0–100; null when not a number. */
export function parseLeadPct(raw: string): number | null {
  if (!raw.trim()) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}
