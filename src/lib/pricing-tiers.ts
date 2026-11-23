import { frac } from "@/lib/stores/pricing";
import { getCompany } from "@/lib/identity/companies";
import {
  contactsForCompany,
  displayName,
} from "@/lib/identity/contacts";
import {
  DEFAULT_PRICING_TIER,
  PRICING_TIERS,
  type PricingTier,
} from "@/lib/identity/config";

/**
 * Customer pricing-tier resolution (punch item 11, D87; design §4.7).
 *
 * The tier lives on the PERSON — "if Eric calls, he gets his pricing no
 * matter where he's at." Resolution order on a quote:
 *   1. the quote's designated contact's tier (the "attn" contact),
 *   2. else that company's tier,
 *   3. else Base.
 * The resolved markup SEEDS pricing (estimators can override per quote) and
 * is stamped onto the quote at creation so history is stable; each revision
 * re-stamps at cut time (item 24 / B). Never shown to customers (E).
 *
 * Markups are admin-editable in /estimating-rules → "Customer tiers";
 * defaults: base 43 · copper 37 · silver 28 · gold 25 · platinum 18 ·
 * reseller 11 · employee 5 (percent, markup on cost: sell = cost × (1 + k)).
 */

const TIER_DEFAULTS: Record<PricingTier, number> = {
  base: 0.43,
  copper: 0.37,
  silver: 0.28,
  gold: 0.25,
  platinum: 0.18,
  reseller: 0.11,
  employee: 0.05,
};

export type ResolvedTier = {
  tier: PricingTier;
  /** Markup fraction (0.43 = 43 %), #367. */
  markup: number;
  /** Where the tier came from — for tooltips/audit, never customer-facing. */
  source: "contact" | "company" | "default";
};

function asTier(v: string | null | undefined): PricingTier | null {
  return v && (PRICING_TIERS as readonly string[]).includes(v)
    ? (v as PricingTier)
    : null;
}

/** The registry markup for a tier (admin-edited value, else the default). */
export async function tierMarkup(tier: PricingTier): Promise<number> {
  return frac(`tiers.${tier}`, TIER_DEFAULTS[tier]);
}

/**
 * Resolve the tier + markup for a quote context. `contactName` is the
 * quote's attn contact (display name — the only contact key quote docs
 * carry); matched against the company's people.
 */
export async function resolveTier(
  companyId: string | null | undefined,
  contactName?: string | null
): Promise<ResolvedTier> {
  if (companyId) {
    const wanted = (contactName || "").trim();
    if (wanted) {
      const people = await contactsForCompany(companyId);
      const person = people.find((p) => displayName(p) === wanted);
      const t = asTier(person?.pricingTier);
      if (t) return { tier: t, markup: await tierMarkup(t), source: "contact" };
    }
    const co = await getCompany(companyId);
    const t = asTier(co?.pricingTier);
    if (t) return { tier: t, markup: await tierMarkup(t), source: "company" };
  }
  return {
    tier: DEFAULT_PRICING_TIER,
    markup: await tierMarkup(DEFAULT_PRICING_TIER),
    source: "default",
  };
}

/**
 * Markup map for a set of companies (company-or-default resolution only —
 * used to seed builder markup knobs when a customer is picked client-side,
 * before any contact is designated).
 */
export async function tierMarkupByCompany(
  companyIds: string[]
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of companyIds) {
    const r = await resolveTier(id);
    out[id] = r.markup;
  }
  return out;
}

