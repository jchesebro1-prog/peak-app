/**
 * Estimator handoff — the Move / Copy system helpers (actions.ts placeSystemInEstimate, copy-pricing's
 * copyPricingFor and catalog-renames' follow-the-renames helpers) over the HandoffStore. Moved out of
 * estimator-actions.ts unchanged. Plan: PR 2 Task 4.
 */
import type * as Original from "@/app/(app)/estimator/actions";
import type { Quote } from "@/lib/stores/quotes";
import type { SpecMob, SpecSection, VendorQuote } from "@/app/(app)/estimator/types";
import type { SystemGroup } from "@/lib/estimate-groups/groups";
import type { CopyCatalogPart, CopyFixture } from "@/lib/estimating-core/copy-system";
import { totals } from "@/lib/estimating-core/pricing";
import { normalizeSystemOrder, sanitizeGroups, withoutGroupMeta } from "@/lib/estimate-groups/groups";
import { sanitizePackageDoc } from "@/lib/package-doc/sanitize";
import { docIdFloor } from "@/lib/package-doc/ids";
import { reIdIncomingSection } from "@/lib/estimate-line-move/reid";
import { canonicalBonusSections } from "@/lib/estimate-bonus/canonical";
import { stripBonusLines } from "@/lib/estimate-bonus/rules";
import { rewardCreditOf, withRewardCredit, withoutRewardCredit } from "@/lib/rewards/credit-line";
import { normalizePackageSelection, type PackageSelection } from "@/lib/estimate-output/package-selection";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { allAssembliesFrom, fixtureSkus, type FixtureRecord } from "@/lib/fixture-assemblies";
import { rewriteQuoteSpec } from "@/lib/catalog-rename/rewrite";
import { applyProjectDiscounts, discountsForSections, mergeDiscountsForSave, sanitizeProjectDiscounts, type ProjectDiscounts } from "@/lib/project-discounts/rules";
import { REVISE_FIRST, repriceLocked } from "@/lib/estimate-reprice/lock";
import { boxSaleOf, boxSaleSaveProblem } from "@/lib/estimate-box-sale/rules";
import { refresh } from "../router";
import type { HandoffStore } from "../store";
import { customers } from "../ports";
import { bonusRatesNow, bySkuResolver, listFixtures, liveCatalog, renameRefs } from "../readers";
import type { QuoteRepo } from "../quote-repo";
import { vendorIdsInSections, vendorQuoteRows, vendorQuotesForSave, type QuotePatch } from "./save-core";
import { maxItemId } from "./util";
import { clock } from "../ports";

/** catalog-renames quoteSpecFollowingRenames / selectionFollowingRenames over the slice's rename stubs. */
export async function renameHelpers(store: HandoffStore) {
  const { m, models } = await renameRefs(store);
  return {
    rewriteSpec: <T,>(spec: T): T => {
      if (!m.size) return spec;
      const next = rewriteQuoteSpec(spec, m, models);
      return next === null ? spec : (next as T);
    },
    followSelection: async (sel: PackageSelection): Promise<PackageSelection> => {
      if (!sel.excludedDatasheets.length || !m.size || !sel.excludedDatasheets.some((s) => m.has(s))) return sel;
      return normalizePackageSelection({ ...sel, excludedDatasheets: sel.excludedDatasheets.map((s) => m.get(s) ?? s) });
    },
    renames: { m, models },
  };
}

/** copy-pricing copyPricingFor over the store: today's catalog + resolved fixtures for exactly these lines' SKUs. */
export async function copyPricingFor(store: HandoffStore, items: readonly SpecSection["items"][number][]) {
  const skus = new Set<string>();
  const fixtureIds = new Set<string>();
  for (const it of items) {
    if (it?.sku) skus.add(it.sku);
    const comps = Array.isArray(it?.components) ? it.components : [];
    if (comps.length) {
      if (!it.track) fixtureIds.add(it.fixtureId || it.sku);
      comps.forEach((c) => c?.sku && skus.add(c.sku));
    }
  }
  let fixtureRecords: FixtureRecord[] = [];
  if (fixtureIds.size) {
    fixtureRecords = (await listFixtures(store)).filter((r) => fixtureIds.has(r.id));
    fixtureRecords.forEach((r) => fixtureSkus(r).forEach((s) => skus.add(s)));
  }
  const rows = await liveCatalog(store);
  const resolve = bySkuResolver(rows, store.catalogRenames);
  const found = new Map<string, (typeof rows)[number]>();
  for (const s of skus) {
    const p = resolve(s);
    if (p) found.set(s, p);
  }
  const parts = [...new Map([...found.values()].map((p) => [p.sku, p] as const)).values()];
  const catalog = new Map<string, CopyCatalogPart>();
  for (const [sku, p] of found) {
    const cost = Number(p.cost);
    if (!p.sku || !(Number.isFinite(cost) && cost > 0) || catalog.has(sku)) continue;
    catalog.set(sku, { sku: p.sku, cost, list: Number(p.list) || 0 });
  }
  const fixtures = new Map<string, CopyFixture>();
  if (fixtureRecords.length) {
    for (const a of allAssembliesFrom(fixtureRecords, parts)) {
      fixtures.set(a.id, {
        id: a.id,
        components: a.components.filter((c) => c.found && (c.cost > 0 || c.costOverride !== undefined)).map((c) => ({ sku: c.sku, cost: c.cost, list: c.list })),
      });
    }
  }
  return { catalog, fixtures, renames: (await renameHelpers(store)).renames };
}

export type SourceContext = { customerId: string | null; locationId: string | null; customer: string; contactName: string };

/**
 * actions.ts placeSystemInEstimate — the shared tail of Move and Copy: an existing target gains the
 * section (re-id'd, bonus lines re-derived, its own credit re-pinned); a new target is a draft for the
 * source's customer. Only the vendor quotes this section's own lines name travel. Box goods sale: a labor system is refused into an existing box sale, and a NEW target copies the stored source's flag. Left out: vendor
 * parties, the lead/companies split and Scope-only inheritance (#348 — no parties in the prototype), PDFs.
 */
export async function placeSystemInEstimate(
  store: HandoffStore,
  repo: QuoteRepo,
  placed: SpecSection,
  target: Original.MoveSystemTarget,
  opts: { newName: string; sourceContext: SourceContext; vendorQuotes: VendorQuote[]; owner: string; tier?: { pricingTier: string; tierMargin: number }; sourceQuoteId?: string | null; /** the acting user's id (#366 stamps `by`) */ by?: string; /** #366 — the source's project discounts as posted (undefined = the stored source's); only a NEW target reads them */ projectDiscounts?: unknown },
): Promise<{ ok: true; targetId: string; targetName: string; targetNumber: string } | { ok: false; error: string }> {
  const placedIds = vendorIdsInSections([placed]);
  const rates = bonusRatesNow();
  // Only records this section's own lines name travel; stamped against the target's own rows (prepareVendorQuotesForSave).
  const carry = (targetRows: unknown) =>
    vendorQuotesForSave({ vendorQuotes: targetRows, revisions: [] }, vendorQuoteRows(opts.vendorQuotes).filter((vq) => placedIds.has(vq.id)), [placed], clock.now(), customers.isVendorCompany);
  if (target.kind === "existing") {
    const existing = await repo.get(target.quoteId);
    if (!existing) return { ok: false, error: "That estimate could not be found." };
    // #368: a sent / won / lost estimate keeps its prices — nothing is placed into it until it is revised.
    if (repriceLocked(existing.status)) return { ok: false, error: REVISE_FIRST };
    // Box goods sale (spec 2026-10-21): a system with labor can't join an existing box sale — refused before anything
    // is written. Move/Copy into a NEW estimate is unchanged (the new estimate starts as a normal one).
    if (boxSaleOf(existing)) {
      const problem = boxSaleSaveProblem(true, [placed]);
      if (problem) return { ok: false, error: problem };
    }
    const placedVq = carry(existing.vendorQuotes);
    const existingSpec = existing.spec as { sections?: SpecSection[]; mobs?: SpecMob[]; groups?: SystemGroup[]; document?: unknown; projectDiscounts?: unknown } | null | undefined;
    // #366: the TARGET's own project discounts decide — a part it has no discount for goes back to its normal cost.
    const targetDiscounts = sanitizeProjectDiscounts(existingSpec?.projectDiscounts);
    const existingDoc = sanitizePackageDoc(existingSpec?.document);
    const existingGroups = sanitizeGroups(existingSpec?.groups);
    const incoming = reIdIncomingSection(stripBonusLines(withoutGroupMeta(placed)), existingSpec?.sections || [], docIdFloor(existingDoc));
    const appendedRaw = normalizeSystemOrder([...(existingSpec?.sections || []), ...withoutRewardCredit([incoming])], existingGroups);
    const appended = canonicalBonusSections({ source: existing.source, quoteType: existing.quoteType, status: existing.status }, applyProjectDiscounts(appendedRaw, targetDiscounts), rates);
    const mergedSections = withRewardCredit(appended, rewardCreditOf(appended), maxItemId(appended) + 1);
    const t = totals(mergedSections, 0);
    const updated = await repo.update(target.quoteId, {
      spec: { sections: normalizeSystemOrder(mergedSections, existingGroups), mobs: existingSpec?.mobs || [], groups: existingGroups, ...(existingDoc ? { document: existingDoc } : {}), ...(Object.keys(targetDiscounts).length ? { projectDiscounts: targetDiscounts } : {}) },
      value: t.grand,
      margin: t.markup,
      ...(placedVq.length ? { vendorQuotes: [...vendorQuoteRows(existing.vendorQuotes).filter((vq) => !placedIds.has(vq.id)), ...placedVq] } : {}),
    } as QuotePatch);
    if (!updated) return { ok: false, error: "That estimate could not be found." };
    refresh();
    return { ok: true, targetId: updated.id, targetName: updated.name, targetNumber: displayQuoteNumber(updated) };
  }
  const placedVq = carry([]);
  // Box goods sale: Move / Copy → New estimate copies the STORED source's flag (an unsaved or unknown source has none).
  const sourceId = typeof opts.sourceQuoteId === "string" && opts.sourceQuoteId ? opts.sourceQuoteId : null;
  const sourceQuote = sourceId ? await repo.get(sourceId) : null;
  const newSections = canonicalBonusSections({ source: "estimator", status: "draft" }, withoutRewardCredit([stripBonusLines(withoutGroupMeta(placed))]), rates);
  // #366: a NEW estimate carries the source's discount entries for the SKUs this system contains (the builder's map, re-stamped
  // like a save against the stored source's; the stored map alone when none was posted), applied after the bonus lines.
  const storedSourceDiscounts = sanitizeProjectDiscounts((sourceQuote?.spec as { projectDiscounts?: unknown } | null | undefined)?.projectDiscounts);
  const sourceDiscounts: ProjectDiscounts = opts.projectDiscounts !== undefined ? mergeDiscountsForSave(storedSourceDiscounts, opts.projectDiscounts, opts.by ?? "", clock.now()) : storedSourceDiscounts;
  const carriedDiscounts = discountsForSections(newSections, sourceDiscounts);
  const newSpecSections = applyProjectDiscounts(newSections, carriedDiscounts);
  const t = totals(newSpecSections, 0);
  let created: Quote;
  try {
    created = await repo.create({
      name: opts.newName,
      customer: opts.sourceContext.customer,
      customerId: opts.sourceContext.customerId,
      locationId: opts.sourceContext.locationId,
      source: "estimator",
      status: "draft",
      spec: { sections: newSpecSections, mobs: [], ...(Object.keys(carriedDiscounts).length ? { projectDiscounts: carriedDiscounts } : {}) },
      value: t.grand,
      margin: t.markup,
      owner: opts.owner,
      ...(opts.tier ? { pricingTier: opts.tier.pricingTier, tierMargin: opts.tier.tierMargin } : {}),
      ...(boxSaleOf(sourceQuote) ? { boxSale: true } : {}),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not create the new estimate — please try again." };
  }
  const withContact = await repo.update(created.id, {
    contactName: opts.sourceContext.contactName || "",
    ...(placedVq.length ? { vendorQuotes: placedVq } : {}),
  } as QuotePatch);
  refresh();
  return { ok: true, targetId: created.id, targetName: (withContact || created).name, targetNumber: displayQuoteNumber(withContact || created) };
}
