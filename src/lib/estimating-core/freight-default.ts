/**
 * New-section freight defaults (#245, spec 2026-09-27-portal-catalog-design.md
 * §2.2) — pure. `sectionFreightDefault` decides what a fresh system's freight %
 * should start at: the rule's base % until a venue is picked, then the
 * distance rule (src/lib/freight-rule.ts). `applyAutoFreight` re-applies that
 * default when the customer/venue selection changes, but only to sections
 * staff never touched (`freightAuto === true`) — a saved quote loaded with no
 * `freightAuto` flag (or `false`, once hand-edited) is never rewritten.
 */
import { freightPctForMiles, type FreightRule } from "@/lib/freight-rule";
import type { SpecSection } from "./types";

export function sectionFreightDefault(input: {
  hasVenue: boolean;
  miles: number | null | undefined;
  rule: FreightRule;
}): { pct: number; unknown: boolean } {
  if (!input.hasVenue) return { pct: input.rule.basePct, unknown: false };
  const r = freightPctForMiles(input.miles, input.rule);
  return { pct: r.pct, unknown: r.atCapUnknown };
}

export function applyAutoFreight(sections: SpecSection[], d: { pct: number }): SpecSection[] {
  return sections.map((s) => (s.freightAuto ? { ...s, freightPct: d.pct } : s));
}
