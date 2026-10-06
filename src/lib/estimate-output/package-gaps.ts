import type { SpecSection } from "@/app/(app)/estimator/types";
import { printableKeyProducts } from "@/app/(app)/estimator/narrative";
import { systemPrintsInBody } from "@/app/(app)/estimator/quote-document-view";
import { outputScopes } from "./scopes";

/**
 * #301 slice C (spec §6) — the staff-only gap chips in the Client link
 * panel (decision 13: the client page lists only what's included). Pure.
 * Counts come from the LIVE quote — the next send (Slice C adaptation 10).
 */

export type PackageGapCounts = { noDatasheet: number; drawings: number; keyProductsNeedText: number; scopesNoGoals: number };

/** Key products on printed systems whose paragraph is blank. */
export function keyProductsNeedingText(sections: SpecSection[]): number {
  return (sections || []).filter(systemPrintsInBody).reduce((n, s) => n + printableKeyProducts(s).filter((k) => k.blocks.length === 0).length, 0);
}

/** Printed, non-labor scopes with no client goals (labor never matches a discipline — R2). */
export function scopesWithoutGoals(sections: SpecSection[]): number {
  return outputScopes({ sections: sections || [] }).filter((s) => !s.isLabor && !s.clientGoals).length;
}

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function packageGapChips(c: PackageGapCounts): string[] {
  const out: string[] = [];
  if (c.noDatasheet > 0) out.push(`${n(c.noDatasheet, "part", "parts")} without a datasheet`);
  if (c.drawings === 0) out.push("No drawings");
  if (c.keyProductsNeedText > 0) out.push(`${n(c.keyProductsNeedText, "key product needs", "key products need")} a paragraph`);
  if (c.scopesNoGoals > 0) out.push(`No client goals on ${n(c.scopesNoGoals, "scope", "scopes")}`);
  return out;
}