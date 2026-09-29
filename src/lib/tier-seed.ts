import { PRICING_TIER_LABEL, type PricingTier } from "@/lib/identity/config";

/**
 * #254 — the service builders' margin knob follows the customer's pricing
 * tier (flame test, repair, inspection; D457).
 *
 * The knob is SEEDED, never enforced (D87/D88): picking a customer or a
 * contact resolves a new seed — the contact's own tier margin, else the
 * company's own tier margin, else the builder's own default margin (the
 * service's Estimating Rules default, not tier Base's 30 %). A knob still at
 * the previous seed moves to the new one; a hand-set knob is kept and the
 * builder offers the new seed as a one-click prompt.
 *
 * Pure and import-light (identity/config has no imports), so the "use client"
 * builders and their server pages share it.
 */

export type TierSeedContact = {
  name: string;
  /** Margin fraction of the contact's OWN tier; null/absent when they have none. */
  tierMargin?: number | null;
  tier?: PricingTier | null;
};
export type TierSeedCustomer = {
  /** Margin fraction of the company's OWN tier; null/absent when it has none. */
  tierMargin?: number | null;
  tier?: PricingTier | null;
  contacts: TierSeedContact[];
};

/** A resolved seed in whole knob points; label null = the service default. */
export type TierSeed = { pts: number; label: string | null };

/** A hand-set knob that was kept on a customer/contact change. */
export type TierPrompt = { keptPts: number; seed: TierSeed };

function validMargin(m: number | null | undefined): m is number {
  return m != null && Number.isFinite(m) && m > 0 && m < 1;
}

/** A margin fraction as whole knob points; null when it isn't a usable margin. */
export function knobPtsFrom(m: number | null | undefined): number | null {
  return validMargin(m) ? Math.round(m * 100) : null;
}

function labelOf(tier: PricingTier | null | undefined): string | null {
  return tier ? PRICING_TIER_LABEL[tier] ?? null : null;
}

/**
 * The seed for a customer + contact: contact's own tier → company tier →
 * `serviceDefault` (a margin fraction). `contactName` "" = no known contact.
 */
export function seedFor(
  customer: TierSeedCustomer | null | undefined,
  contactName: string,
  serviceDefault: number
): TierSeed {
  const wanted = (contactName || "").trim();
  if (customer && wanted) {
    const ct = customer.contacts.find((c) => c.name === wanted);
    if (ct && validMargin(ct.tierMargin))
      return { pts: Math.round(ct.tierMargin * 100), label: labelOf(ct.tier) };
  }
  if (customer && validMargin(customer.tierMargin))
    return { pts: Math.round(customer.tierMargin * 100), label: labelOf(customer.tier) };
  return { pts: knobPtsFrom(serviceDefault) ?? 0, label: null };
}

/**
 * The knob and the "previous seed" a builder opens with. A new quote opens at
 * the seed for its preselected customer/contact. A saved quote reopens at its
 * own saved knob (never re-seeded on load); its previous seed is the knob
 * itself when the knob still equals the quote's stamped tier margin or
 * today's seed (it was never hand-set), else the stamp, else today's seed.
 */
export function initialTierSeed(opts: {
  customer: TierSeedCustomer | null | undefined;
  contactName: string;
  serviceDefault: number;
  /** The saved quote's knob in points (null for a new quote). */
  savedMarginPts?: number | null;
  /** The saved quote's stamped tier margin fraction. */
  stampedTierMargin?: number | null;
}): { knobPts: number; prevSeedPts: number } {
  const loaded = seedFor(opts.customer, opts.contactName, opts.serviceDefault).pts;
  const saved = opts.savedMarginPts;
  if (saved == null || !Number.isFinite(saved)) return { knobPts: loaded, prevSeedPts: loaded };
  const stamp = knobPtsFrom(opts.stampedTierMargin);
  const untouched = saved === stamp || saved === loaded;
  return { knobPts: saved, prevSeedPts: untouched ? saved : stamp ?? loaded };
}

/**
 * A customer or contact change: an untouched knob (still at the previous
 * seed) moves to the new seed; a hand-set knob is kept, with a prompt
 * offering the new seed unless the knob already sits on it. The new seed
 * becomes the previous seed either way.
 */
export function reseedKnob(
  knobPts: number,
  prevSeedPts: number,
  next: TierSeed
): { knobPts: number; prevSeedPts: number; prompt: TierPrompt | null } {
  if (knobPts === prevSeedPts || knobPts === next.pts)
    return { knobPts: next.pts, prevSeedPts: next.pts, prompt: null };
  return { knobPts, prevSeedPts: next.pts, prompt: { keptPts: knobPts, seed: next } };
}

/** "Kept your 25% margin — Gold is 20%" · "Use Gold". */
export function tierPromptText(p: TierPrompt): { text: string; action: string } {
  const who = p.seed.label ? `${p.seed.label} is` : "the default is";
  return {
    text: `Kept your ${p.keptPts}% margin — ${who} ${p.seed.pts}%`,
    action: p.seed.label ? `Use ${p.seed.label}` : `Use ${p.seed.pts}%`,
  };
}
