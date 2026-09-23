import { type Port } from "@/lib/catalog-connect";

/**
 * Port rules (#159, D193) — an ordered list matched first-wins against a
 * catalog part to decide WHICH port shape applies.
 *
 * The list is the reviewable artifact: Jeff approves, edits or rejects a RULE,
 * and that verdict covers every part it matched. Review effort therefore
 * scales with rules (~30) rather than parts (thousands), and a rule is
 * checkable from experience in a way an individual row is not.
 *
 * First match wins, deliberately. A scored best-match would make "why did this
 * part get these ports?" unanswerable, and answering that is the entire point
 * of reviewing rules.
 */

/** The part fields a rule may look at. Deliberately narrow. */
export type RulePart = { sku: string; desc: string; category: string; mfr?: string };

export type PortRule = {
  /** Stable id — this is what gets named in `--rules` to approve it. */
  id: string;
  /** Exact manufacturer, when the rule is brand-specific. */
  mfr?: string;
  category?: RegExp;
  desc: RegExp;
  /** Description patterns this rule must NOT match. */
  exclude?: RegExp;
  shape: (part: RulePart) => Port[];
  /** Match means "no ports, deliberately" — an accessory, not a miss (D195). */
  accessory?: true;
  /** Why this rule is correct. Read during review; keep it a real reason. */
  note: string;
};

/** Populated in Task 3. */
export const PORT_RULES: readonly PortRule[] = [];

export function matchRule(
  part: RulePart,
  rules: readonly PortRule[] = PORT_RULES
): PortRule | null {
  for (const rule of rules) {
    if (rule.mfr && rule.mfr !== (part.mfr || "")) continue;
    if (rule.category && !rule.category.test(part.category || "")) continue;
    if (!rule.desc.test(part.desc || "")) continue;
    if (rule.exclude && rule.exclude.test(part.desc || "")) continue;
    return rule;
  }
  return null;
}

/**
 * The ports a rule proposes for a part, or null when nothing applies.
 *
 * An ACCESSORY match also returns null — it has no ports by definition. That
 * is a success, not a miss, and the two must not be conflated in the report or
 * 907 correctly-ignored brackets would hide the real coverage gaps (D195).
 * Callers that need the distinction use matchRule() and check `.accessory`.
 */
export function proposeForPart(
  part: RulePart,
  rules: readonly PortRule[] = PORT_RULES
): { rule: PortRule; ports: Port[] } | null {
  const rule = matchRule(part, rules);
  if (!rule || rule.accessory) return null;
  return { rule, ports: rule.shape(part) };
}
