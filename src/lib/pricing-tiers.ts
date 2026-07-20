import { frac } from "@/lib/stores/pricing";
import { getCompany } from "@/lib/identity/companies";
import { contactsForCompany, displayName } from "@/lib/identity/contacts";
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
 * The resolved margin SEEDS pricing (estimators can override per quote) and
 * is stamped onto the quote at creation so history is stable; each revision
 * re-stamps at cut time (item 24 / B). Never shown to customers (E).
 *
 * Margins are admin-editable in /estimating-rules → "Customer tiers";
 * defaults: base 30 · copper 27 · silver 22 · gold 20 · platinum 15 ·
 * reseller 10 · employee 5 (percent, margin-on-price: sell = cost ÷ (1−m)).
 */

const TIER_DEFAULTS: Record<PricingTier, number> = {
  base: 0.3,
  copper: 0.27,
  silver: 0.22,
  gold: 0.2,
  platinum: 0.15,
  reseller: 0.1,
  employee: 0.05,
};

export type ResolvedTier = {
  tier: PricingTier;
  /** Margin-on-price fraction (0.30 = 30%). */
  margin: number;
  /** Where the tier came from — for tooltips/audit, never customer-facing. */
  source: "contact" | "company" | "default";
};

function asTier(v: string | null | undefined): PricingTier | null {
  return v && (PRICING_TIERS as readonly string[]).includes(v)
    ? (v as PricingTier)
    : null;
}

/** The registry margin for a tier (admin-edited value, else the default). */
export async function tierMargin(tier: PricingTier): Promise<number> {
  return frac(`tiers.${tier}`, TIER_DEFAULTS[tier]);
}

/**
 * Resolve the tier + margin for a quote context. `contactName` is the
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
      if (t) return { tier: t, margin: await tierMargin(t), source: "contact" };
    }
    const co = await getCompany(companyId);
    const t = asTier(co?.pricingTier);
    if (t) return { tier: t, margin: await tierMargin(t), source: "company" };
  }
  return {
    tier: DEFAULT_PRICING_TIER,
    margin: await tierMargin(DEFAULT_PRICING_TIER),
    source: "default",
  };
}

/**
 * Margin map for a set of companies (company-or-default resolution only —
 * used to seed builder margin knobs when a customer is picked client-side,
 * before any contact is designated).
 */
export async function tierMarginByCompany(
  companyIds: string[]
): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const id of companyIds) {
    const r = await resolveTier(id);
    out[id] = r.margin;
  }
  return out;
}

export type BuilderTier = {
  /** Company-level margin (company tier, else Base). */
  margin: number;
  /** Personal margins for contacts that carry their OWN tier, by display name. */
  byContact: Record<string, number>;
};

/**
 * Tier info for the service-quote builders (flame/repair/inspection): the
 * customer picker seeds the margin knob from these when a customer is
 * chosen — contact's own tier first, else the company's, else Base.
 */
export async function builderTiers(
  companyIds: string[]
): Promise<Record<string, BuilderTier>> {
  const out: Record<string, BuilderTier> = {};
  for (const id of companyIds) {
    const companyLevel = await resolveTier(id);
    const byContact: Record<string, number> = {};
    for (const p of await contactsForCompany(id)) {
      const t = asTier(p.pricingTier);
      if (t) byContact[displayName(p)] = await tierMargin(t);
    }
    out[id] = { margin: companyLevel.margin, byContact };
  }
  return out;
}
