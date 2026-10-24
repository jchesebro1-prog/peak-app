/* Assessments engine (#340, Task 9) — "Quote these findings", the server half. Server-only (stores).
   - Repair quote: nothing is created here. The selection is checked and the caller is sent to the repair builder's
     intake (/repairs/quote?customer=…&findings=…), which pre-fills from the findings and prices them like any
     repair; the builder's save links the findings to the quote it creates (findingKeysForSave + linkOnCreate).
   - Estimator quote: a draft Estimator quote with one zero-priced line per finding is created and linked, and the
     caller is sent to it. */
import { create as createQuote, type Quote } from "@/lib/stores/quotes";
import { getFindings, linkQuote, type Finding } from "@/lib/stores/findings";
import { getCompany } from "@/lib/identity/companies";
import { docLocId, getSite } from "@/lib/identity/sites";
import { resolveTier } from "@/lib/pricing-tiers";
import { loadFreightRule } from "@/lib/freight-rule-load";
import { canonicalBonusSections } from "@/lib/estimate-bonus/canonical";
import { loadBonusRates } from "@/lib/stores/pricing";
import { totals } from "@/app/(app)/estimator/pricing";
import { findingsEstimatorSection, parseFindingKeys, quoteSelectionProblem } from "./findings-quote";

export type QuoteKind = "repair" | "estimator";
export type QuoteFromFindingsResult = { ok: true; href: string; quote?: Quote; /** the assessments the quoted findings belong to (their pages need revalidating) */ assessmentIds?: string[]; /** set when the quote exists but linking the findings failed */ linkNotice?: string } | { ok: false; error: string };

export const LINK_FAILED_NOTICE = "The quote was created, but its findings couldn't be linked to it. Link them from the findings register (Link existing quote…).";
export const OTHER_VENUE_NOTICE = "Findings weren't linked: they belong to another venue.";
/** Test-only: makes the link step throw, so the "link failed after create" path can be exercised. */
export interface LinkTestOpts { __failLinkForTest?: boolean }

const byPrinted = (a: Finding, b: Finding) =>
  (a.printedId === null ? 1 : 0) - (b.printedId === null ? 1 : 0) ||
  (a.printedId ?? "").localeCompare(b.printedId ?? "", undefined, { numeric: true }) ||
  a.key.localeCompare(b.key);

/** The findings behind these keys, checked as one quotable selection (one customer, one venue, none voided), in
 *  printed-id order. A key that names no finding refuses the whole selection. */
export async function loadQuotableFindings(rawKeys: unknown): Promise<{ ok: true; list: Finding[] } | { ok: false; error: string }> {
  const keys = parseFindingKeys(rawKeys);
  if (!keys.length) return { ok: false, error: "Choose the findings to quote." };
  const byKey = await getFindings(keys);
  const found = keys.map((k) => byKey.get(k));
  if (found.some((f) => !f)) return { ok: false, error: "A chosen finding no longer exists. Reload and try again." };
  const list = found as Finding[];
  const problem = quoteSelectionProblem(list);
  if (problem) return { ok: false, error: problem };
  return { ok: true, list: list.sort(byPrinted) };
}

/** The venue's display name ("" when the site is gone). */
export function venueNameOf(site: { name?: string | null; locationName?: string | null } | null): string {
  return site?.name || site?.locationName || "";
}

/** Quote these findings. `user` must already hold `create` (the action checks). */
export async function quoteFromFindings(rawKeys: unknown, kind: QuoteKind, user: { id: string; name: string }, now = Date.now(), test: LinkTestOpts = {}): Promise<QuoteFromFindingsResult> {
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
  const sections = canonicalBonusSections({ source: "estimator", quoteType: "system", status: "draft" }, [section], await loadBonusRates());
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
    margin: t.markup,
    owner: user.name,
    preparedBy: user.name,
    pricingTier: tier.tier,
    tierMargin: tier.markup,
    findingKeys: keys,
  });
  // The quote now exists: a link failure must never read as "nothing was created" (a retry would duplicate it).
  // The quote carries its findingKeys either way, so the findings can be linked later from the register.
  let linkNotice: string | undefined;
  try {
    if (test.__failLinkForTest) throw new Error("test: link failed");
    await linkQuote(keys, quote.id, user);
  } catch (error) {
    console.error("quoteFromFindings: linking findings to the created quote failed", error);
    linkNotice = LINK_FAILED_NOTICE;
  }
  return { ok: true, href: `/estimator?id=${encodeURIComponent(quote.id)}`, quote, assessmentIds: [...new Set(list.map((f) => f.assessmentId))], ...(linkNotice ? { linkNotice } : {}) };
}

/**
 * The repair builder's save (persist): the finding keys its hidden `findingKeys` field carries, kept only on a
 * CREATE (an edit never re-links), only for live findings of the quote's own customer, and only when they are one
 * venue's findings (quoteSelectionProblem) AND that venue is one of the venues the quote was saved with (`venueIds`
 * are the posted venue loc ids). Anything else links nothing and returns a non-blocking notice; the quote still
 * saves. No field -> { keys: [], notice: null } with no DB call, so the builder behaves exactly as before.
 */
export async function findingKeysForSave(raw: unknown, customerId: string, editing: boolean, venueIds: readonly string[] = []): Promise<{ keys: string[]; notice: string | null }> {
  const none = { keys: [] as string[], notice: null };
  if (editing || raw === null || raw === undefined || raw === "") return none;
  const keys = parseFindingKeys(typeof raw === "string" ? raw : "");
  if (!keys.length || !customerId) return none;
  const byKey = await getFindings(keys);
  const live = keys.map((k) => byKey.get(k)).filter((f): f is Finding => !!f && !f.voided && f.customerId === customerId);
  if (!live.length) return none;
  const refuse = { keys: [] as string[], notice: OTHER_VENUE_NOTICE };
  if (quoteSelectionProblem(live) !== null) return refuse;
  const site = await getSite(live[0].siteId);
  if (!site || !venueIds.includes(docLocId(site))) return refuse;
  return { keys: live.map((f) => f.key), notice: null };
}

/** After the builder created `quoteId` from findings: they get the quote in quoteRefs and move to quoted. */
export async function linkOnCreate(keys: string[], quoteId: string | null | undefined, user: { id: string }, editing: boolean, test: LinkTestOpts = {}): Promise<void> {
  if (editing || !quoteId || !keys.length) return;
  if (test.__failLinkForTest) throw new Error("test: link failed");
  await linkQuote(keys, quoteId, user);
}

/** linkOnCreate for a save that has already created the quote: a failure is logged and returned as a notice, never
 *  thrown (a throw would read as "nothing was saved" and a re-save would duplicate the quote). null = linked/no-op. */
export async function linkOnCreateSafe(keys: string[], quoteId: string | null | undefined, user: { id: string }, editing: boolean, test: LinkTestOpts = {}): Promise<string | null> {
  try {
    await linkOnCreate(keys, quoteId, user, editing, test);
    return null;
  } catch (error) {
    console.error("repairs quote: linking findings to the created quote failed", error);
    return LINK_FAILED_NOTICE;
  }
}
