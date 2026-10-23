import { frac } from "@/lib/stores/pricing";
import { getCompanies, getCompany } from "@/lib/identity/companies";
import {
  contactsForCompanies,
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

/**
 * The markup a service quote actually prices/stamps at: an untiered customer
 * (`resolveTier`'s `source === "default"`) uses the SERVICE'S OWN default
 * markup (`serviceDefault` — the service's Estimating Rules `baseRates.margin`,
 * the same value the builder's margin knob seeds from, src/lib/tier-seed.ts
 * `seedFor`), never tier Base's registry margin — the two agree today only
 * because every service default happens to be 0.30 (#254 follow-up; D457).
 * A resolved contact/company tier is unchanged.
 */
export function serviceMarkupFor(tier: ResolvedTier, serviceDefault: number): number {
  return tier.source === "default" ? serviceDefault : tier.markup;
}

export type BuilderTier = {
  /** Company-level markup (company tier, else Base). */
  markup: number;
  /** Personal markups for contacts that carry their OWN tier, by display name. */
  byContact: Record<string, number>;
  /** The company's OWN tier (null = none set → the builder's own default, #254). */
  tier: PricingTier | null;
  /** The OWN tier of each contact in `byContact`, by display name (#254 prompt label). */
  byContactTier: Record<string, PricingTier>;
};

/**
 * Tier info for the service-quote builders (flame/repair/inspection): the
 * customer picker seeds the markup knob from these when a customer is
 * chosen — contact's own tier first, else the company's, else Base.
 */
export async function builderTiers(
  companyIds: string[]
): Promise<Record<string, BuilderTier>> {
  const out: Record<string, BuilderTier> = {};
  if (!companyIds.length) return out;

  /* Batched (punch #90). This used to loop the company list serially, awaiting
     getCompany() + contactsForCompany() + a margin read PER company — ~3,400
     sequential round trips for the real directory (~1,700 companies), which is
     what made the three service-quote builders take seconds locally and would
     be far worse against a hosted Postgres. Two bulk queries now, plus at most
     one margin read per DISTINCT tier (there are seven). Resolution order is
     unchanged: contact tier → company tier → default. */
  const [companies, contactsByCompany] = await Promise.all([
    getCompanies(companyIds),
    contactsForCompanies(companyIds),
  ]);

  const markupCache = new Map<PricingTier, number>();
  const markupFor = async (tier: PricingTier): Promise<number> => {
    const hit = markupCache.get(tier);
    if (hit != null) return hit;
    const k = await tierMarkup(tier);
    markupCache.set(tier, k);
    return k;
  };
  const defaultMarkup = await markupFor(DEFAULT_PRICING_TIER);

  for (const id of companyIds) {
    const companyTier = asTier(companies.get(id)?.pricingTier);
    const byContact: Record<string, number> = {};
    const byContactTier: Record<string, PricingTier> = {};
    for (const p of contactsByCompany.get(id) || []) {
      const t = asTier(p.pricingTier);
      if (t) {
        byContact[displayName(p)] = await markupFor(t);
        byContactTier[displayName(p)] = t;
      }
    }
    out[id] = {
      markup: companyTier ? await markupFor(companyTier) : defaultMarkup,
      byContact,
      tier: companyTier,
      byContactTier,
    };
  }
  return out;
}
