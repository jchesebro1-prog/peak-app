/**
 * Estimator handoff — browser implementations of src/app/(app)/estimator/actions.ts, over the
 * HandoffStore (quote-repo.ts) and the ports. Each mirrors its original's validation and result
 * shape — enforced by the type map below (`Impl<K>` is the original's own signature) — and names
 * what it leaves out. Registered under the fileKey "src/app/(app)/estimator/actions.ts" (main.tsx).
 *
 * Where the original revalidates (`refresh()` / revalidatePath), these call the router's refresh(),
 * which re-reads the EstimatorProps from the store — the prototype's server re-render.
 *
 * Refused with NOT_IN_PROTOTYPE (registered explicitly): draftQuoteScopeAction (surveys /
 * inspections aren't sliced), the quote task actions (no tasks store) and declinePortalAcceptanceAction
 * (no portal). Plan: PR 2 Task 4.
 */
import type * as Original from "@/app/(app)/estimator/actions";
import type { Quote } from "@/lib/stores/quotes";
import type { QuoteNextStepView } from "@/lib/quote-next-step";
import type { CatalogSearch, QuoteLite, SpecMob, SpecSection, TravelLite, VendorQuote } from "@/app/(app)/estimator/types";
import type { SystemGroup } from "@/lib/estimate-groups/groups";
import type { CopyCatalogPart, CopyFixture } from "@/lib/estimating-core/copy-system";
import { copySectionForTarget } from "@/lib/estimating-core/copy-system";
import { rankCatalogParts } from "@/lib/estimating-core/catalog-rank";
import { withSanitizedKeyProducts } from "@/lib/estimating-core/narrative";
import { seedMarginOf, usableTierMargin } from "@/lib/estimating-core/tier-reprice";
import { sanitizeSystemSell, totals } from "@/lib/estimating-core/pricing";
import { COVER_SUMMARY_MAX, NOT_INCLUDED_MAX, cleanPlainText, withSanitizedOutputFields } from "@/lib/estimate-output/fields";
import { normalizeSystemOrder, sanitizeGroups, withoutGroupMeta } from "@/lib/estimate-groups/groups";
import { sanitizePackageDoc } from "@/lib/package-doc/sanitize";
import { docIdFloor } from "@/lib/package-doc/ids";
import { reIdIncomingSection } from "@/lib/estimate-line-move/reid";
import { canonicalBonusSections } from "@/lib/estimate-bonus/canonical";
import { stripBonusLines } from "@/lib/estimate-bonus/rules";
import { rewardCreditOf, quoteRewardCredit, withRewardCredit, withoutRewardCredit } from "@/lib/rewards/credit-line";
import { normalizePackageSelection, type PackageSelection } from "@/lib/estimate-output/package-selection";
import { normalizePdfOptions } from "@/lib/quote-pdf/pdf-options";
import { documentRevStamp } from "@/lib/quote-pdf/state";
import { displayQuoteNumber, quoteSearchRank } from "@/lib/estimate-number";
import { PRICING_TIER_LABEL } from "@/lib/identity/config";
import { rackFactsOrUndefined } from "@/lib/rack/part-facts";
import { allAssembliesFrom, fixtureSkus, type FixtureRecord } from "@/lib/fixture-assemblies";
import { reopenedAtWonVersion } from "@/lib/quote-won-version";
import { quoteOwnerName } from "@/lib/review-limits";
import { sameName } from "@/lib/quote-approval-rules";
import { canChangeQuotePeople, PEOPLE_LOCKED_AFTER_SEND } from "@/lib/quote-people-lock";
import { rewriteQuoteSpec } from "@/lib/catalog-rename/rewrite";
import { NOT_IN_PROTOTYPE, type ActionImpl } from "../actions-registry";
import { refresh } from "../router";
import type { HandoffStore } from "../store";
import { clock, customers, refreshPortsFromStore, resolveTierFor, settingsView, users, type TeamUser } from "../ports";
import { bonusRatesNow, bySkuResolver, listFixtures, liveCatalog, renameRefs } from "../readers";
import { nextStepFor } from "../props/estimator";
import { quoteRepo, type QuoteRepo } from "../quote-repo";
import { isApprovalGateRefusal, resolveSaveStatusChange, STAGES, statusFailureMessage } from "../quote-model";
import { planSave, vendorIdsInSections, vendorQuoteRows, vendorQuotesForSave, type QuotePatch } from "./save-core";

export const ESTIMATOR_ACTIONS_KEY = "src/app/(app)/estimator/actions.ts";

type A = typeof Original;
/** The original action's own signature, resolved (args → awaited result). */
type Impl<K extends keyof A> = A[K] extends (...a: infer P) => Promise<infer R> ? (...a: P) => Promise<R> : never;

export type ImplementedEstimatorAction =
  | "saveQuoteAction"
  | "saveEstimatorCustomPartAction"
  | "searchCatalog"
  | "resolveCatalogSkusAction"
  | "resolveTierAction"
  | "travelForSelectionAction"
  | "updateQuoteMetaAction"
  | "setQuotePeopleAction"
  | "setStatusAction"
  | "setQuoteStageAction"
  | "setQuotePipelineAction"
  | "saveBonusSplitAction"
  | "saveBonusAlternatesAction"
  | "moveSystemToEstimateAction"
  | "copySystemToEstimateAction"
  | "searchQuotesAction";

/** Registered as refusals (NOT_IN_PROTOTYPE), never as an unregistered call. */
export const REFUSED_ESTIMATOR_ACTIONS = [
  "draftQuoteScopeAction",
  "addQuoteTaskAction",
  "removeQuoteTaskAction",
  "updateQuoteTaskAction",
  "setQuoteTaskStatusAction",
  "applyQuoteTemplateAction",
  "declinePortalAcceptanceAction",
] as const satisfies readonly (keyof A)[];

/** The Next.js permission error requirePerm would throw, as the typed refusal these actions return instead. */
const NO_PERMISSION = "You don't have permission to do that.";

const nextFor = (q: Quote | null, user: TeamUser): QuoteNextStepView | null =>
  q ? nextStepFor(q as Parameters<typeof nextStepFor>[0], user, users.all(), settingsView().reviewLimits, clock.now()) : null;

/** catalog-renames quoteSpecFollowingRenames / selectionFollowingRenames over the slice's rename stubs. */
async function renameHelpers(store: HandoffStore) {
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
async function copyPricingFor(store: HandoffStore, items: readonly SpecSection["items"][number][]) {
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

type SourceContext = { customerId: string | null; locationId: string | null; customer: string; contactName: string };

/**
 * actions.ts placeSystemInEstimate — the shared tail of Move and Copy: an existing target gains the
 * section (re-id'd, bonus lines re-derived, its own credit re-pinned); a new target is a draft for the
 * source's customer. Only the vendor quotes this section's own lines name travel. Left out: vendor
 * parties, the lead/companies split and Scope-only inheritance (#348 — no parties in the prototype), PDFs.
 */
async function placeSystemInEstimate(
  store: HandoffStore,
  repo: QuoteRepo,
  placed: SpecSection,
  target: Original.MoveSystemTarget,
  opts: { newName: string; sourceContext: SourceContext; vendorQuotes: VendorQuote[]; owner: string; tier?: { pricingTier: string; tierMargin: number } },
): Promise<{ ok: true; targetId: string; targetName: string; targetNumber: string } | { ok: false; error: string }> {
  const placedIds = vendorIdsInSections([placed]);
  const rates = bonusRatesNow();
  // Only records this section's own lines name travel; stamped against the target's own rows (prepareVendorQuotesForSave).
  const carry = (targetRows: unknown) =>
    vendorQuotesForSave({ vendorQuotes: targetRows, revisions: [] }, vendorQuoteRows(opts.vendorQuotes).filter((vq) => placedIds.has(vq.id)), [placed], clock.now(), customers.isVendorCompany);
  if (target.kind === "existing") {
    const existing = await repo.get(target.quoteId);
    if (!existing) return { ok: false, error: "That estimate could not be found." };
    const placedVq = carry(existing.vendorQuotes);
    const existingSpec = existing.spec as { sections?: SpecSection[]; mobs?: SpecMob[]; groups?: SystemGroup[]; document?: unknown } | null | undefined;
    const existingDoc = sanitizePackageDoc(existingSpec?.document);
    const existingGroups = sanitizeGroups(existingSpec?.groups);
    const incoming = reIdIncomingSection(stripBonusLines(withoutGroupMeta(placed)), existingSpec?.sections || [], docIdFloor(existingDoc));
    const appendedRaw = normalizeSystemOrder([...(existingSpec?.sections || []), ...withoutRewardCredit([incoming])], existingGroups);
    const appended = canonicalBonusSections({ source: existing.source, quoteType: existing.quoteType, status: existing.status }, appendedRaw, rates);
    const maxItemId = appended.reduce((m, sec) => Math.max(m, ...(sec?.items || []).map((it) => (typeof it?.id === "number" ? it.id : 0))), 0);
    const mergedSections = withRewardCredit(appended, rewardCreditOf(appended), maxItemId + 1);
    const t = totals(mergedSections, 0);
    const updated = await repo.update(target.quoteId, {
      spec: { sections: normalizeSystemOrder(mergedSections, existingGroups), mobs: existingSpec?.mobs || [], groups: existingGroups, ...(existingDoc ? { document: existingDoc } : {}) },
      value: t.grand,
      margin: t.margin,
      ...(placedVq.length ? { vendorQuotes: [...vendorQuoteRows(existing.vendorQuotes).filter((vq) => !placedIds.has(vq.id)), ...placedVq] } : {}),
    } as QuotePatch);
    if (!updated) return { ok: false, error: "That estimate could not be found." };
    refresh();
    return { ok: true, targetId: updated.id, targetName: updated.name, targetNumber: displayQuoteNumber(updated) };
  }
  const placedVq = carry([]);
  const newSections = canonicalBonusSections({ source: "estimator", status: "draft" }, withoutRewardCredit([stripBonusLines(withoutGroupMeta(placed))]), rates);
  const t = totals(newSections, 0);
  let created: Quote;
  try {
    created = await repo.create({
      name: opts.newName,
      customer: opts.sourceContext.customer,
      customerId: opts.sourceContext.customerId,
      locationId: opts.sourceContext.locationId,
      source: "estimator",
      status: "draft",
      spec: { sections: newSections, mobs: [] },
      value: t.grand,
      margin: t.margin,
      owner: opts.owner,
      ...(opts.tier ? { pricingTier: opts.tier.pricingTier, tierMargin: opts.tier.tierMargin } : {}),
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

/** The browser implementations, over `store`. Every action re-reads the settings / blobs first (refreshPortsFromStore). */
export function estimatorActions(store: HandoffStore): { [K in ImplementedEstimatorAction]: Impl<K> } {
  const repo = quoteRepo(store);
  const ready = () => refreshPortsFromStore(store);

  const saveQuoteAction: Impl<"saveQuoteAction"> = async (loadedId, payload) => {
    await ready();
    const user = users.current();
    const prior = loadedId ? await repo.get(loadedId) : null;
    const tier = resolveTierFor(payload.customerId || null, payload.contactName || "");
    const { rewriteSpec } = await renameHelpers(store);
    const plan = planSave(prior, payload, { bonusRates: bonusRatesNow(), tier: { tier: tier.tier, margin: tier.margin }, rewriteSpec });
    if (!plan.ok) {
      // A document refusal writes nothing and returns no id (the client must not adopt it as saved);
      // a credit refusal keeps the loaded id, as the original does.
      const doc = plan.refusedBeforeWrite === "document";
      return {
        ok: false,
        id: doc ? null : loadedId,
        number: doc ? null : prior ? displayQuoteNumber(prior) : null,
        revNum: documentRevStamp(prior ?? {}).revNum,
        updatedAt: prior?.updatedAt ?? clock.now(),
        review: prior?.review ?? null,
        status: prior?.status ?? null,
        pipelineId: prior?.pipelineId ?? null,
        stage: prior?.stage ?? null,
        error: plan.error,
      };
    }
    if (plan.valueAdjusted) console.warn("[estimator] saveQuoteAction: posted value", payload.value, "≠ recomputed", plan.patch.value, "— stored the recomputed value");
    const storedVendorQuotes = vendorQuotesForSave(prior, payload.vendorQuotes, plan.savedSections, clock.now(), customers.isVendorCompany);
    let q: Quote | null = null;
    let statusError: string | undefined;
    let reopenedAtWon = false;
    let statusNotice: string | undefined = plan.notice;
    if (loadedId) {
      q = await repo.update(loadedId, { ...plan.patch, vendorQuotes: storedVendorQuotes } as QuotePatch);
      if (q) {
        const decision = resolveSaveStatusChange(payload.status, payload.baseStatus, q.status);
        if (decision.kind === "apply") {
          try {
            const beforeMove = q;
            q = (await repo.setStatus(loadedId, payload.status, user.name)) ?? q;
            reopenedAtWon = reopenedAtWonVersion(beforeMove, q);
          } catch (e) {
            statusError = statusFailureMessage(e, "estimator/actions saveQuoteAction: setStatus on an existing quote threw");
          }
        } else if (decision.kind === "stalePassive") statusNotice = decision.notice;
        else if (decision.kind === "staleConflict") statusError = decision.error;
      }
    } else {
      let created: Quote;
      try {
        created = await repo.create({ ...plan.patch, owner: user.name } as Partial<Quote>);
      } catch (e) {
        return {
          ok: false, id: null, number: null, revNum: 1, updatedAt: clock.now(), review: null, status: null, pipelineId: null, stage: null,
          error: e instanceof Error ? e.message : "Could not create the quote — please try again.",
        };
      }
      q = await repo.update(created.id, {
        contactName: payload.contactName || "",
        quoteNote: payload.quoteNote || "",
        assumptions: payload.assumptions || "",
        paymentTerms: payload.paymentTerms,
        category: (payload.category || "").trim(),
        vendorQuotes: storedVendorQuotes,
        pdfOptions: normalizePdfOptions(payload.pdfOptions),
      } as QuotePatch);
      if (payload.status !== "draft") {
        try {
          q = (await repo.setStatus(created.id, payload.status, user.name)) ?? q;
        } catch (e) {
          statusError = statusFailureMessage(e, "estimator/actions saveQuoteAction: setStatus on a newly created quote threw");
        }
      }
      q = q || created;
      await repo.retireReplacedDraftSafely(payload.replaces, created.id);
    }
    refresh();
    return {
      ok: !!q && !statusError,
      id: q?.id ?? null,
      number: q ? displayQuoteNumber(q) : null,
      revNum: documentRevStamp(q ?? {}).revNum,
      updatedAt: q?.updatedAt ?? clock.now(),
      review: q?.review ?? null,
      status: q?.status ?? null,
      pipelineId: q?.pipelineId ?? null,
      stage: q?.stage ?? null,
      vendorQuotes: storedVendorQuotes,
      pdf: null,
      next: nextFor(q, user),
      rewardCredit: q?.status === "lost" ? quoteRewardCredit(q) : plan.credit,
      ...(statusError ? { error: statusError } : {}),
      ...(statusNotice ? { notice: statusNotice } : {}),
      ...(reopenedAtWon ? { reopenedAtWon: true } : {}),
    };
  };

  const saveEstimatorCustomPartAction: Impl<"saveEstimatorCustomPartAction"> = async (input) => {
    const sku = input.sku.trim();
    const desc = input.desc.trim();
    if (!sku || sku.toUpperCase() === "CUSTOM") return { ok: false, error: "A catalog SKU is required." };
    if (!desc || !Number.isFinite(input.cost) || input.cost < 0 || !Number.isFinite(input.list) || input.list <= 0) {
      return { ok: false, error: "Catalog parts need a description, cost, and sell price." };
    }
    if ((await liveCatalog(store)).some((p) => p.sku === sku)) {
      return { ok: false, error: `${sku} is already in the catalog — add it with "+ Add part from catalog", or use a different SKU.` };
    }
    const mfr = input.mfr.trim();
    const mpn = input.manufacturerPartNumber.trim();
    await store.put("catalog", {
      id: sku,
      sku,
      desc,
      category: input.category.trim() || "Custom Parts",
      unit: input.unit.trim() || "ea",
      cost: input.cost,
      list: input.list,
      ...(mfr ? { mfr } : {}),
      ...(mpn ? { manufacturerPartNumber: mpn } : {}),
      ...(input.priceGoodThrough ? { note: `Price good through ${input.priceGoodThrough}` } : {}),
    });
    return { ok: true, sku };
  };

  const searchCatalog: Impl<"searchCatalog"> = async (query, category = "", limit = 40, perLengthOnly = false): Promise<CatalogSearch> => {
    const q = (query || "").trim().toLowerCase();
    const cat = (category || "").trim();
    if (!q && !cat) return { hits: [], total: 0 };
    const scored = rankCatalogParts(await liveCatalog(store), q, { category: cat, perLengthOnly });
    const hits = scored.slice(0, Math.max(1, limit)).map(({ p }) => ({
      sku: p.sku,
      desc: p.desc,
      category: p.category || "",
      unit: p.unit || "ea",
      cost: p.cost || 0,
      list: p.list || 0,
      mfr: p.mfr || "",
      ...(p.pricedAt ? { pricedAt: p.pricedAt } : {}),
      ...(p.priceDate ? { priceDate: p.priceDate } : {}),
      ...(p.manufacturerModelNumber?.trim() ? { model: p.manufacturerModelNumber.trim() } : {}),
      ...(p.manufacturerPartNumber?.trim() ? { mpn: p.manufacturerPartNumber.trim() } : {}),
      rack: rackFactsOrUndefined(p),
    }));
    return { hits, total: scored.length };
  };

  const resolveCatalogSkusAction: Impl<"resolveCatalogSkusAction"> = async (skus) => {
    const wanted = (skus || []).slice(0, 2000).filter((s) => typeof s === "string" && s.trim());
    const out: Record<string, Original.ResolvedCatalogSku> = {};
    if (!wanted.length) return out;
    const bySku = new Map<string, Original.ResolvedCatalogSku>();
    for (const p of await liveCatalog(store)) {
      const key = (p.sku || "").trim().toLowerCase();
      if (!key || bySku.has(key)) continue;
      const mfr = (p.mfr || "").trim();
      const mpn = (p.manufacturerPartNumber || "").trim();
      const mmn = (p.manufacturerModelNumber || "").trim();
      bySku.set(key, {
        sku: p.sku,
        desc: p.desc || "",
        unit: p.unit || "ea",
        cost: p.cost || 0,
        list: p.list || 0,
        ...(mfr ? { mfr } : {}),
        ...(mpn ? { manufacturerPartNumber: mpn } : {}),
        ...(mmn ? { manufacturerModelNumber: mmn } : {}),
      });
    }
    for (const requested of wanted) {
      const hit = bySku.get(requested.trim().toLowerCase());
      if (hit) out[requested] = hit;
    }
    return out;
  };

  const resolveTierAction: Impl<"resolveTierAction"> = async (customerId, contactName) => {
    try {
      await ready();
      const r = resolveTierFor(typeof customerId === "string" && customerId ? customerId : null, typeof contactName === "string" ? contactName : "");
      return { ok: true, pricingTier: r.tier, tierMargin: r.margin, label: PRICING_TIER_LABEL[r.tier] || r.tier };
    } catch (e) {
      console.error("[estimator] resolveTierAction failed:", e);
      return { ok: false };
    }
  };

  const travelForSelectionAction: Impl<"travelForSelectionAction"> = async (customerId, locationId): Promise<TravelLite | null> => {
    if (!customerId) return null;
    await ready();
    const est = customers.travelFor(locationId || null, customerId);
    // travelForId returns null when the customer has no venue to travel to.
    return est.miles == null && est.minutes == null && est.officeName == null ? null : est;
  };

  const updateQuoteMetaAction: Impl<"updateQuoteMetaAction"> = async (id, meta) => {
    if (!id) return { ok: false };
    const patch: QuotePatch = {};
    if ("customerId" in meta) patch.customerId = meta.customerId ?? null;
    if ("locationId" in meta) patch.locationId = meta.locationId ?? null;
    if (typeof meta.customer === "string") patch.customer = meta.customer;
    if (typeof meta.contactName === "string") patch.contactName = meta.contactName;
    if (typeof meta.quoteNote === "string") patch.quoteNote = meta.quoteNote;
    if (typeof meta.assumptions === "string") patch.assumptions = meta.assumptions;
    if (typeof meta.installTimeframe === "string") patch.installTimeframe = meta.installTimeframe.trim();
    if (typeof meta.category === "string") patch.category = meta.category.trim();
    if (typeof meta.coverSummary === "string") patch.coverSummary = cleanPlainText(meta.coverSummary, COVER_SUMMARY_MAX);
    if (typeof meta.notIncluded === "string") patch.notIncluded = cleanPlainText(meta.notIncluded, NOT_INCLUDED_MAX);
    if (typeof meta.name === "string" && meta.name.trim()) patch.name = meta.name.trim();
    let selectionError: string | undefined;
    if (meta.packageSelection !== undefined) {
      const r = await repo.setPackageSelection(id, meta.packageSelection, (await renameHelpers(store)).followSelection);
      if (!r.ok) selectionError = r.error;
    }
    if (!Object.keys(patch).length) {
      if (!selectionError) refresh();
      return selectionError ? { ok: false, error: selectionError } : { ok: true };
    }
    const q = await repo.update(id, patch);
    refresh();
    return { ok: !!q && !selectionError, ...(selectionError ? { error: selectionError } : {}) };
  };

  /** quote-people setQuotePeopleAs over the ports' roster; permissions through users.can. */
  const setQuotePeopleAction: Impl<"setQuotePeopleAction"> = async (id, people) => {
    await ready();
    const user = users.current();
    const input: { owner?: unknown; preparedBy?: unknown } = people && typeof people === "object" ? people : {};
    const q = id ? await repo.get(id) : null;
    const cur = { owner: q?.owner || "", preparedBy: q?.preparedBy || "" };
    const refuse = (error: string): Awaited<ReturnType<Impl<"setQuotePeopleAction">>> => ({ ok: false, error, ...cur, next: nextFor(q, user) });
    if (!users.can("create")) return refuse("You need create permission to change a quote's lead estimator or Prepared by.");
    if (!q) return refuse("Quote not found.");
    const wantsOwner = "owner" in input && input.owner !== undefined;
    const wantsPrepared = "preparedBy" in input && input.preparedBy !== undefined;
    if (!wantsOwner && !wantsPrepared) return { ok: true, ...cur, next: nextFor(q, user) };
    const roster = users.all();
    const rosterName = (v: unknown): string | null => {
      if (typeof v !== "string" || !v.trim()) return null;
      return roster.find((u) => sameName(u.name, v))?.name ?? null;
    };
    const owner = wantsOwner ? rosterName(input.owner) : cur.owner;
    const preparedBy = wantsPrepared ? rosterName(input.preparedBy) : cur.preparedBy;
    if (owner === null || preparedBy === null) return refuse("Pick someone on the team.");
    const approver = users.can("approve");
    if (!canChangeQuotePeople(q, approver) && (!sameName(owner, cur.owner) || !sameName(preparedBy, cur.preparedBy))) return refuse(PEOPLE_LOCKED_AFTER_SEND);
    const handsOff = (next: string, before: string) => !sameName(next, before) && !sameName(next, user.name) && !!next.trim();
    if (!approver) {
      if (wantsOwner && handsOff(owner, cur.owner)) return refuse("Only an approver can make someone else the lead estimator.");
      if (handsOff(quoteOwnerName({ owner, preparedBy }), quoteOwnerName(cur))) return refuse("Only an approver can make someone else the lead estimator.");
    }
    if (owner === cur.owner && preparedBy === cur.preparedBy) return { ok: true, owner, preparedBy, next: nextFor(q, user) };
    const saved = await repo.setQuotePeople(id, { ...(owner !== cur.owner ? { owner } : {}), ...(preparedBy !== cur.preparedBy ? { preparedBy } : {}) });
    if (!saved) return refuse("Quote not found.");
    refresh();
    return { ok: true, owner: saved.owner || "", preparedBy: saved.preparedBy || "", next: nextFor(saved, user) };
  };

  const syncOf = async (id: string, user: TeamUser): Promise<Original.ReviewSync> => {
    const q = await repo.get(id);
    return { ok: !!q, review: q?.review ?? null, status: q?.status ?? null, next: nextFor(q, user) };
  };
  const stageSyncOf = async (id: string, user: TeamUser): Promise<Original.StageSync> => {
    const q = await repo.get(id);
    return { ok: !!q, status: q?.status ?? null, review: q?.review ?? null, pipelineId: q?.pipelineId ?? null, stage: q?.stage ?? null, next: nextFor(q, user) };
  };

  /** setStatusAction — the gate pre-checked (typed refusal), then the store's setStatus; a move into Won runs the onWon port (quote-repo). */
  const setStatusAction: Impl<"setStatusAction"> = async (id, status, opts) => {
    await ready();
    const user = users.current();
    if (!id || !(STAGES as readonly string[]).includes(status)) return { ok: false, review: null, status: null };
    const before = await repo.get(id);
    if (status === "won" || status === "sent") {
      const gate = await repo.checkApprovalGate(before, status, user.name);
      if (!gate.ok) return { ok: false, review: before?.review ?? null, status: before?.status ?? null, error: gate.error, gateRefused: true };
    }
    try {
      await repo.setStatus(id, status, user.name, Array.isArray(opts?.alternatesTaken) ? { alternatesTaken: opts.alternatesTaken.filter((x): x is string => typeof x === "string") } : {});
    } catch (e) {
      const cur = await repo.get(id);
      return {
        ok: false,
        review: cur?.review ?? null,
        status: cur?.status ?? null,
        error: statusFailureMessage(e, `estimator/actions setStatusAction(${status}): setStatus threw`),
        gateRefused: isApprovalGateRefusal(e),
      };
    }
    refresh();
    const sync = await syncOf(id, user);
    return reopenedAtWonVersion(before, await repo.get(id)) ? { ...sync, reopenedAtWon: true } : sync;
  };

  const saveBonusSplitAction: Impl<"saveBonusSplitAction"> = async (id, leadPct) => {
    if (!users.can("approve")) return { ok: false, error: NO_PERMISSION };
    try {
      if (!id) return { ok: false, error: "Missing quote." };
      if (typeof leadPct !== "number" || !Number.isFinite(leadPct)) return { ok: false, error: "Enter a percentage" };
      const saved = await repo.setEstimatorBonusSplit(id, { leadPct });
      if (!saved) return { ok: false, error: "Quote not found" };
      refresh();
      return { ok: true };
    } catch (e) {
      console.error("[estimator] saveBonusSplitAction failed:", e);
      return { ok: false, error: "Couldn't save — try again" };
    }
  };

  const saveBonusAlternatesAction: Impl<"saveBonusAlternatesAction"> = async (id, ids) => {
    if (!users.can("approve")) return { ok: false, error: NO_PERMISSION };
    try {
      if (!id) return { ok: false, error: "Missing quote." };
      const saved = await repo.setBonusAlternatesTaken(id, Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : []);
      if (!saved) return { ok: false, error: "Quote not found" };
      if (saved === "not-won") return { ok: false, error: "Only a won estimate records alternates here" };
      if (saved === "no-bonus-lines") return { ok: false, error: "This estimate has no bonus lines" };
      refresh();
      return { ok: true };
    } catch (e) {
      console.error("[estimator] saveBonusAlternatesAction failed:", e);
      return { ok: false, error: "Couldn't save — try again" };
    }
  };

  const setQuoteStageAction: Impl<"setQuoteStageAction"> = async (id, stageId, alternatesTaken) => {
    await ready();
    const user = users.current();
    if (!id || !stageId) return { ok: false, status: null, review: null, pipelineId: null, stage: null };
    const before = await repo.get(id);
    let q: Quote | null;
    try {
      q = await repo.setQuoteStage(id, stageId, user.name, Array.isArray(alternatesTaken) ? alternatesTaken.filter((x): x is string => typeof x === "string") : undefined);
    } catch (e) {
      const cur = await repo.get(id);
      return {
        ok: false, status: cur?.status ?? null, review: cur?.review ?? null, pipelineId: cur?.pipelineId ?? null, stage: cur?.stage ?? null,
        error: statusFailureMessage(e, `estimator/actions setQuoteStageAction(${stageId}): setQuoteStage threw`),
        gateRefused: isApprovalGateRefusal(e),
      };
    }
    if (!q) {
      const cur = await repo.get(id);
      return {
        ok: false, status: cur?.status ?? null, review: cur?.review ?? null, pipelineId: cur?.pipelineId ?? null, stage: cur?.stage ?? null,
        error: "That stage isn't available for this quote — refresh and try again.",
      };
    }
    refresh();
    const sync = await stageSyncOf(id, user);
    return reopenedAtWonVersion(before, await repo.get(id)) ? { ...sync, reopenedAtWon: true } : sync;
  };

  const setQuotePipelineAction: Impl<"setQuotePipelineAction"> = async (id, pipelineId) => {
    await ready();
    const user = users.current();
    if (!id || !pipelineId) return { ok: false, status: null, review: null, pipelineId: null, stage: null };
    const q = await repo.setQuotePipeline(id, pipelineId);
    if (!q) {
      const cur = await repo.get(id);
      return { ok: false, status: cur?.status ?? null, review: cur?.review ?? null, pipelineId: cur?.pipelineId ?? null, stage: cur?.stage ?? null, error: "That pipeline change was refused." };
    }
    refresh();
    return stageSyncOf(id, user);
  };

  const searchQuotesAction: Impl<"searchQuotesAction"> = async (query, excludeId, limit = 20): Promise<QuoteLite[]> => {
    await ready();
    const q = (query || "").trim();
    const pool = (await repo.all()).filter((quote) => quote.id !== excludeId);
    const matched = q
      ? pool
          .map((quote, i) => ({ quote, i, r: quoteSearchRank(quote, q) }))
          .filter((x): x is { quote: Quote; i: number; r: number } => x.r !== null)
          .sort((a, b) => a.r - b.r || a.i - b.i)
          .map((x) => x.quote)
      : pool;
    return matched.slice(0, Math.max(1, limit)).map((quote) => ({
      id: quote.id,
      number: displayQuoteNumber(quote),
      name: quote.name,
      customer: quote.customer,
      status: quote.status,
      updatedAt: quote.updatedAt,
    }));
  };

  const moveSystemToEstimateAction: Impl<"moveSystemToEstimateAction"> = async (section, target, sourceContext, vendorQuotes = []) => {
    await ready();
    const user = users.current();
    const [movedRaw] = withoutRewardCredit([withSanitizedKeyProducts({ ...sanitizeSystemSell(section), id: "sys" + clock.now() })]);
    const moved = withoutGroupMeta(withSanitizedOutputFields(movedRaw));
    return placeSystemInEstimate(store, repo, moved, target, { newName: moved.name + " (moved)", sourceContext, vendorQuotes, owner: user.name });
  };

  const copySystemToEstimateAction: Impl<"copySystemToEstimateAction"> = async (sectionIn, target, sourceContext, vendorQuotes = []) => {
    await ready();
    const user = users.current();
    const section = withSanitizedOutputFields(withSanitizedKeyProducts(sectionIn));
    const items = Array.isArray(section?.items) ? section.items : [];
    const { catalog, fixtures, renames } = await copyPricingFor(store, items);
    const sourceTier = usableTierMargin(sourceContext?.tierMargin);
    let targetTier: number | null = sourceTier;
    let targetTierKey: string | null = null;
    let stamp: { pricingTier: string; tierMargin: number } | undefined;
    if (target.kind === "new") {
      const r = resolveTierFor(sourceContext.customerId || null, sourceContext.contactName || "");
      targetTier = r.margin;
      targetTierKey = r.tier;
      stamp = { pricingTier: r.tier, tierMargin: r.margin };
    } else if (target.kind === "existing") {
      const existing = await repo.get(target.quoteId);
      if (!existing) return { ok: false, error: "That estimate could not be found." };
      const stored = usableTierMargin(existing.tierMargin);
      if (stored != null) {
        targetTier = stored;
        targetTierKey = existing.pricingTier || null;
      } else {
        const r = resolveTierFor(existing.customerId || null, existing.contactName || "");
        targetTier = r.margin;
        targetTierKey = r.tier;
      }
    }
    const tierMoved = usableTierMargin(targetTier) != null && seedMarginOf(sourceTier) !== seedMarginOf(targetTier);
    const tierLabel = tierMoved && targetTierKey ? (PRICING_TIER_LABEL as Record<string, string>)[targetTierKey] || targetTierKey : null;
    const copied = copySectionForTarget(sanitizeSystemSell(section), {
      newSectionId: "sys" + clock.now(),
      catalog,
      fixtures,
      sourceTierMargin: sourceTier,
      targetTierMargin: targetTier,
      renames,
    });
    if (target.kind === "same") return { ok: true, kind: "same", section: copied.section, costsUpdated: copied.costsUpdated, tierRepriced: copied.tierRepriced };
    const placed = await placeSystemInEstimate(store, repo, copied.section, target, { newName: section.name + " (copy)", sourceContext, vendorQuotes, owner: user.name, tier: stamp });
    if (!placed.ok) return placed;
    return {
      ok: true,
      kind: target.kind,
      targetId: placed.targetId,
      targetName: placed.targetName,
      targetNumber: placed.targetNumber,
      costsUpdated: copied.costsUpdated,
      tierRepriced: copied.tierRepriced,
      tierLabel,
    };
  };

  return {
    saveQuoteAction,
    saveEstimatorCustomPartAction,
    searchCatalog,
    resolveCatalogSkusAction,
    resolveTierAction,
    travelForSelectionAction,
    updateQuoteMetaAction,
    setQuotePeopleAction,
    setStatusAction,
    setQuoteStageAction,
    setQuotePipelineAction,
    saveBonusSplitAction,
    saveBonusAlternatesAction,
    moveSystemToEstimateAction,
    copySystemToEstimateAction,
    searchQuotesAction,
  };
}

/** The refusals, as registry impls (each returns a fresh NOT_IN_PROTOTYPE). */
export function refusedEstimatorActions(): Record<(typeof REFUSED_ESTIMATOR_ACTIONS)[number], ActionImpl> {
  const warned = new Set<string>();
  const refuse = (name: string) => () => {
    if (!warned.has(name)) {
      warned.add(name);
      console.warn(`[handoff] ${name} is not in the prototype`);
    }
    return { ...NOT_IN_PROTOTYPE };
  };
  return Object.fromEntries(REFUSED_ESTIMATOR_ACTIONS.map((n) => [n, refuse(n)])) as Record<(typeof REFUSED_ESTIMATOR_ACTIONS)[number], ActionImpl>;
}
