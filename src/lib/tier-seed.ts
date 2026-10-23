import { PRICING_TIER_LABEL, type PricingTier } from "@/lib/identity/config";
import { MARKUP_MAX, fmtMarkupPct } from "@/lib/markup";

/**
 * #254 — the service builders' markup knob follows the customer's pricing
 * tier (flame test, repair, inspection; D457). #367: every figure here is a
 * markup on cost.
 *
 * The knob is SEEDED, never enforced (D87/D88): picking a customer or a
 * contact resolves a new seed — the contact's own tier markup, else the
 * company's own tier markup, else the builder's own default markup (the
 * service's Estimating Rules default, not tier Base's). A knob still at
 * the previous seed moves to the new one; a hand-set knob is kept and the
 * builder offers the new seed as a one-click prompt.
 *
 * Pure and import-light (identity/config and markup have no imports), so the "use client"
 * builders and their server pages share it.
 */

export type TierSeedContact = {
  name: string;
  /** Markup fraction of the contact's OWN tier (stored field name); null/absent when they have none. */
  tierMargin?: number | null;
  tier?: PricingTier | null;
};
export type TierSeedCustomer = {
  /** Markup fraction of the company's OWN tier (stored field name); null/absent when it has none. */
  tierMargin?: number | null;
  tier?: PricingTier | null;
  contacts: TierSeedContact[];
};

/** A resolved seed in knob points (exact, #367); label null = the service default. */
export type TierSeed = { pts: number; label: string | null };

/** A hand-set knob that was kept on a customer/contact change. */
export type TierPrompt = { keptPts: number; seed: TierSeed };

const validMarkup = (k: number | null | undefined): k is number =>
  typeof k === "number" && Number.isFinite(k) && k > 0 && k <= MARKUP_MAX;

/** A markup fraction as knob points — EXACT (#367): a saved quote at 42.857 reopens there, so a save that never
 *  touched the knob can't move its $25-rounded total. Null when it isn't a usable markup. */
export function knobPctFrom(k: number | null | undefined): number | null {
  return validMarkup(k) ? k * 100 : null;
}

/** Two knob positions are the same seed: exact points (#367) carry float noise (0.28 × 100 = 28.000000000000004),
 *  so a whole-point drag back onto a seed, or a posted knob's round trip, still counts as on it. */
function samePts(a: number, b: number | null | undefined): boolean {
  return b != null && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6;
}

function labelOf(tier: PricingTier | null | undefined): string | null {
  return tier ? PRICING_TIER_LABEL[tier] ?? null : null;
}

/**
 * The seed for a customer + contact: contact's own tier → company tier →
 * `serviceDefault` (a markup fraction). `contactName` "" = no known contact.
 */
export function seedFor(
  customer: TierSeedCustomer | null | undefined,
  contactName: string,
  serviceDefault: number
): TierSeed {
  const wanted = (contactName || "").trim();
  if (customer && wanted) {
    const ct = customer.contacts.find((c) => c.name === wanted);
    if (ct && validMarkup(ct.tierMargin))
      return { pts: knobPctFrom(ct.tierMargin)!, label: labelOf(ct.tier) };
  }
  if (customer && validMarkup(customer.tierMargin))
    return { pts: knobPctFrom(customer.tierMargin)!, label: labelOf(customer.tier) };
  return { pts: knobPctFrom(serviceDefault) ?? 0, label: null };
}

/**
 * The knob and the "previous seed" a builder opens with. A new quote opens at
 * the seed for its preselected customer/contact. A saved quote reopens at its
 * own saved knob (never re-seeded on load); its previous seed is the knob
 * itself when the knob still equals (or is the same whole percent as, #367)
 * the quote's stamped tier markup or today's seed (it was never hand-set),
 * else the stamp, else today's seed.
 */
export function initialTierSeed(opts: {
  customer: TierSeedCustomer | null | undefined;
  contactName: string;
  serviceDefault: number;
  /** The saved quote's knob in points (null for a new quote). */
  savedMarkupPts?: number | null;
  /** The saved quote's stamped tier markup fraction. */
  stampedTierMarkup?: number | null;
}): { knobPts: number; prevSeedPts: number } {
  const loaded = seedFor(opts.customer, opts.contactName, opts.serviceDefault).pts;
  const saved = opts.savedMarkupPts;
  if (saved == null || !Number.isFinite(saved)) return { knobPts: loaded, prevSeedPts: loaded };
  const stamp = knobPctFrom(opts.stampedTierMarkup);
  // #367: also the same WHOLE percent — a converted quote re-saved once is stamped with today's rounded
  // tier (43) while its knob kept the exact 42.857; that knob was never hand-set, so a later customer
  // change still moves it to the new seed (no "Kept your 42.9%" prompt).
  // (Same rule as markup's sameWholeMarkup, on points; inline so this file keeps its two imports — #254 client pin.)
  const sameWhole = (b: number | null | undefined) => b != null && Number.isFinite(b) && Math.round(saved) === Math.round(b);
  const untouched = samePts(saved, stamp) || samePts(saved, loaded) || sameWhole(stamp) || sameWhole(loaded);
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
  if (samePts(knobPts, prevSeedPts) || samePts(knobPts, next.pts))
    return { knobPts: next.pts, prevSeedPts: next.pts, prompt: null };
  return { knobPts, prevSeedPts: next.pts, prompt: { keptPts: knobPts, seed: next } };
}

/** "Kept your 25% markup — Gold is 20%" · "Use Gold". */
export function tierPromptText(p: TierPrompt): { text: string; action: string } {
  const who = p.seed.label ? `${p.seed.label} is` : "the default is";
  return {
    text: `Kept your ${fmtMarkupPct(p.keptPts / 100)} markup — ${who} ${fmtMarkupPct(p.seed.pts / 100)}`,
    action: p.seed.label ? `Use ${p.seed.label}` : `Use ${fmtMarkupPct(p.seed.pts / 100)}`,
  };
}
