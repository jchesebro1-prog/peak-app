/* Assessments engine (#337, Task 9) — "Quote these findings", the server half. Server-only (stores).
   - Repair quote: nothing is created here. The selection is checked and the caller is sent to the repair builder's
     intake (/repairs/quote?customer=…&findings=…), which pre-fills from the findings and prices them like any
     repair; the builder's save links the findings to the quote it creates (findingKeysForSave + linkOnCreate).
   - Estimator quote: a draft Estimator quote with one zero-priced line per finding is created and linked, and the
     caller is sent to it. */
import { create as createQuote, type Quote } from "@/lib/stores/quotes";
import { getFinding, linkQuote, type Finding } from "@/lib/stores/findings";
import { getCompany } from "@/lib/identity/companies";
import { docLocId, getSite } from "@/lib/identity/sites";
import { resolveTier } from "@/lib/pricing-tiers";
import { loadFreightRule } from "@/lib/freight-rule-load";
import { canonicalBonusSections } from "@/lib/estimate-bonus/canonical";
import { totals } from "@/app/(app)/estimator/pricing";
import { findingsEstimatorSection, parseFindingKeys, quoteSelectionProblem } from "./findings-quote";

export type QuoteKind = "repair" | "estimator";
export type QuoteFromFindingsResult = { ok: true; href: string; quote?: Quote } | { ok: false; error: string };

const byPrinted = (a: Finding, b: Finding) =>
  (a.printedId === null ? 1 : 0) - (b.printedId === null ? 1 : 0) ||
  (a.printedId ?? "").localeCompare(b.printedId ?? "", undefined, { numeric: true }) ||
  a.key.localeCompare(b.key);

/** The findings behind these keys, checked as one quotable selection (one customer, one venue, none voided), in
 *  printed-id order. A key that names no finding refuses the whole selection. */
export async function loadQuotableFindings(rawKeys: unknown): Promise<{ ok: true; list: Finding[] } | { ok: false; error: string }> {
  const keys = parseFindingKeys(rawKeys);
  if (!keys.length) return { ok: false, error: "Choose the findings to quote." };
  const list = await Promise.all(keys.map((k) => getFinding(k)));
  if (list.some((f) => !f)) return { ok: false, error: "A chosen finding no longer exists. Reload and try again." };
  const found = list as Finding[];
  const problem = quoteSelectionProblem(found);
  if (problem) return { ok: false, error: problem };
  return { ok: true, list: found.sort(byPrinted) };
}

/** The venue's display name ("" when the site is gone). */
export function venueNameOf(site: { name?: string | null; locationName?: string | null } | null): string {
  return site?.name || site?.locationName || "";
}

/** Quote these findings. `user` must already hold `create` (the action checks). */
export async function quoteFromFindings(rawKeys: unknown, kind: QuoteKind, user: { id: string; name: string }, now = Date.now()): Promise<QuoteFromFindingsResult> {
  const r = await loadQuotableFindings(rawKeys);
  if (!r.ok) return r;
  const list = r.list;
  const { customerId, siteId } = list[0];
  const keys = list.map((f) => f.key);

  if (kind === "repair") {
    const qs = new URLSearchParams({ customer: customerId, findings: keys.join(",") });
    return { ok: true, href: `/repairs/quote?${qs.toString()}` };
  }
  if (kind !== "estimator") return { ok: false, error: "Choose a repair quote or an Estimator quote." };

  const [company, site, tier, rule] = await Promise.all([getCompany(customerId), getSite(siteId), resolveTier(customerId, ""), loadFreightRule()]);
  if (!company) return { ok: false, error: "That customer no longer exists." };
  const venueName = venueNameOf(site) || siteId;
  const section = findingsEstimatorSection(list, { sectionId: "sys" + now, venueName, freightPct: rule.basePct });
  // Bonus lines at birth, exactly like every other new draft estimate (they price to nothing until lines are priced).
  const sections = canonicalBonusSections({ source: "estimator", quoteType: "system", status: "draft" }, [section]);
  const t = totals(sections, 0);
  const quote = await createQuote({
    name: `Assessment findings — ${venueName}`,
    customer: company.name,
    customerId,
    locationId: site ? docLocId(site) : null,
    source: "estimator",
    status: "draft",
    quoteType: "system",
    spec: { sections, mobs: [] },
    value: t.grand,
    margin: t.margin,
    owner: user.name,
    preparedBy: user.name,
    pricingTier: tier.tier,
    tierMargin: tier.margin,
    findingKeys: keys,
  });
  await linkQuote(keys, quote.id, user);
  return { ok: true, href: `/estimator?id=${encodeURIComponent(quote.id)}`, quote };
}

/**
 * The repair builder's save (persist): the finding keys its hidden `findingKeys` field carries, kept only on a
 * CREATE (an edit never re-links) and only for live findings of the quote's own customer. [] when absent — the
 * builder then behaves exactly as before.
 */
export async function findingKeysForSave(raw: unknown, customerId: string, editing: boolean): Promise<string[]> {
  if (editing || raw === null || raw === undefined || raw === "") return [];
  const keys = parseFindingKeys(typeof raw === "string" ? raw : "");
  if (!keys.length || !customerId) return [];
  const list = await Promise.all(keys.map((k) => getFinding(k)));
  return list.filter((f): f is Finding => !!f && !f.voided && f.customerId === customerId).map((f) => f.key);
}

/** After the builder created `quoteId` from findings: they get the quote in quoteRefs and move to quoted. */
export async function linkOnCreate(keys: string[], quoteId: string | null | undefined, user: { id: string }, editing: boolean): Promise<void> {
  if (editing || !quoteId || !keys.length) return;
  await linkQuote(keys, quoteId, user);
}
