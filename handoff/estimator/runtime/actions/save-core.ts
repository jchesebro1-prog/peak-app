/**
 * Estimator handoff — the pure half of saveQuoteAction (src/app/(app)/estimator/actions.ts ~418–820):
 * everything the server decides about a posted save BEFORE it writes — the package-document gate, the
 * section sanitizers, groups, the server-derived bonus lines, the Rewards credit line, portal POR
 * clearing, the reconciled value, the tier stamp, the header patch, renames, and which vendor quotes
 * survive. The browser action (estimator-actions.ts) does the I/O around it. Plan: PR 2 Task 4.
 */
import type { Quote } from "@/lib/stores/quotes";
import type { SavePayload } from "@/app/(app)/estimator/actions";
import type { SpecMob, SpecSection, VendorQuote, VendorQuoteExtracted, VendorQuoteLine } from "@/app/(app)/estimator/types";
import type { PackageDoc } from "@/lib/package-doc/types";
import type { BonusRates } from "@/lib/estimate-bonus/flags";
import { deriveEstimatorSections } from "@/lib/estimate-reprice/derive";
import { repriceLocked } from "@/lib/estimate-reprice/lock";
import { withSanitizedKeyProducts } from "@/lib/estimating-core/narrative";
import { COVER_SUMMARY_MAX, NOT_INCLUDED_MAX, cleanPlainText, withSanitizedOutputFields } from "@/lib/estimate-output/fields";
import { normalizeSystemOrder, sanitizeGroups, sanitizeSectionGroupMeta, type SystemGroup } from "@/lib/estimate-groups/groups";
import { packageDocForSave } from "@/lib/package-doc/save";
import { clearPricedPor, sourceForSave } from "@/lib/portal-quote-mode";
import { reconcileEstimatorValue, sanitizeSystemSell } from "@/lib/estimating-core/pricing";
import { quoteRewardCredit, rewardCreditOf, sanitizeRewardCredit, withRewardCredit } from "@/lib/rewards/credit-line";
import { normalizePdfOptions } from "@/lib/quote-pdf/pdf-options";
import { keepLiveVendorCompanies, stampVendorQuotes, vendorCompanyIdsOf } from "@/lib/vendor-quotes/rules";
import { ownsVendorQuoteBlobPath } from "@/lib/vendor-quote-file";
import { mergeDiscountsForSave, sanitizeProjectDiscounts, type ProjectDiscounts } from "@/lib/project-discounts/rules";
import { boxSaleForSave, boxSaleSaveProblem } from "@/lib/estimate-box-sale/rules";
import { maxItemId } from "./util";

/** The Estimator's quote doc fields beyond the promoted Quote columns (actions.ts QuoteExtras). */
export type QuotePatch = Partial<Quote> & {
  contactName?: string;
  quoteNote?: string;
  assumptions?: string;
  paymentTerms?: SavePayload["paymentTerms"];
  spec?: { sections: SpecSection[]; mobs: SpecMob[]; groups?: SystemGroup[]; document?: PackageDoc; projectDiscounts?: ProjectDiscounts };
  vendorQuotes?: VendorQuote[];
};

function fmtMoney(n: number): string {
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * actions.ts settleRewardCredit with no company balance (the prototype has no Rewards ledger and
 * applying credit is off): a negative line anywhere but the credit line refuses the save; a won/lost
 * quote keeps the credit it had; otherwise the credit is clamped to 0 (removed, with the notice). Pure.
 */
export function settleRewardCreditOffline(
  sections: SpecSection[],
  prior: Pick<Quote, "status" | "spec" | "quoteType"> | null,
): { ok: true; sections: SpecSection[]; credit: number; notice?: string } | { ok: false; error: string } {
  if (!Array.isArray(sections)) return { ok: true, sections, credit: 0 };
  if (prior && (prior.status === "won" || prior.status === "lost")) {
    const locked = quoteRewardCredit(prior as Quote);
    const check = sanitizeRewardCredit(sections, Number.POSITIVE_INFINITY);
    if (!check.ok) return check;
    const out = withRewardCredit(check.sections, locked, maxItemId(sections) + 1);
    return { ok: true, sections: out, credit: rewardCreditOf(out) };
  }
  const res = sanitizeRewardCredit(sections, 0);
  if (!res.ok) return res;
  const notice =
    res.rounded && res.credit > 0
      ? `Rewards credit rounded down to whole dollars (${fmtMoney(res.credit)}) — credit applies as whole points.`
      : res.clamped && res.credit > 0
      ? `Rewards credit reduced to ${fmtMoney(res.credit)} — that's what this customer has available.`
      : res.clamped
      ? "Rewards credit removed — this customer has no credit available for this quote."
      : undefined;
  return { ok: true, sections: res.sections, credit: res.credit, ...(notice ? { notice } : {}) };
}

/** Vendor-quote ids the items of these sections reference (#143). */
export function vendorIdsInSections(sections: SpecSection[] | undefined | null): Set<string> {
  const out = new Set<string>();
  (Array.isArray(sections) ? sections : []).forEach((sec) =>
    (sec?.items || []).forEach((it) => {
      if (it && it.vendorQuoteId) out.add(it.vendorQuoteId);
    }),
  );
  return out;
}

/** A stored `quote.vendorQuotes` blob narrowed to records with a string id. */
export function vendorQuoteRows(raw: unknown): VendorQuote[] {
  return Array.isArray(raw) ? (raw as VendorQuote[]).filter((v) => !!v && typeof v === "object" && typeof v.id === "string") : [];
}

/** save-server withoutRead: the `extracted` key removed and every line's extractedIndex stripped. */
function withoutRead<T extends VendorQuote>(vq: T): T {
  const out = { ...vq };
  delete out.extracted;
  if (Array.isArray(vq.lines)) {
    out.lines = vq.lines.map((l) => {
      if (!l || typeof l !== "object" || !("extractedIndex" in l)) return l;
      const { extractedIndex: _i, ...rest } = l;
      void _i;
      return rest as VendorQuoteLine;
    });
  }
  return out;
}

/** save-server withRead: a kept read; extractedIndex survives only inside the read's line range. */
function withRead<T extends VendorQuote>(vq: T, extracted: VendorQuoteExtracted): T {
  const n = extracted.data.lines?.length ?? 0;
  const lines = Array.isArray(vq.lines)
    ? vq.lines.map((l) => {
        if (!l || typeof l !== "object" || !("extractedIndex" in l)) return l;
        const i = l.extractedIndex;
        if (typeof i === "number" && Number.isInteger(i) && i >= 0 && i < n) return l;
        const { extractedIndex: _i, ...rest } = l;
        void _i;
        return rest as VendorQuoteLine;
      })
    : vq.lines;
  return { ...vq, lines, extracted };
}

/**
 * verifyVendorPdfExtractions without the Assist run log: a read is kept only when the prior stored
 * copy has the same runId (it was verified when first saved); any other read is dropped — the
 * prototype has no Read-the-PDF runs to vouch for a new one. Pure.
 */
export function verifyVendorReadsOffline<T extends VendorQuote>(prior: readonly VendorQuote[], next: readonly T[]): T[] {
  const priorById = new Map<string, VendorQuote>();
  for (const p of prior) if (p && typeof p.id === "string") priorById.set(p.id, p);
  return next.map((vq) => {
    const x = vq?.extracted as { runId?: unknown } | null | undefined;
    if (!x) return withoutRead(vq);
    const kept = priorById.get(vq.id)?.extracted;
    if (kept && typeof kept === "object" && typeof kept.runId === "string" && kept.data && kept.runId === x.runId) {
      return withRead(vq, { runId: kept.runId, model: kept.model, at: kept.at, data: kept.data });
    }
    return withoutRead(vq);
  });
}

/** actions.ts storeVendorQuotes with Blob storage off: a `blobPath` is kept only when it is this record's own; the data-URL stays. Pure. */
export function storeVendorQuotesOffline(vendorQuotes: VendorQuote[]): VendorQuote[] {
  return vendorQuotes.map((vq) => {
    const att = vq.attachment;
    if (!att) return vq;
    const stored = ownsVendorQuoteBlobPath(att.blobPath, vq.id) ? att.blobPath : undefined;
    if (stored) return att.dataUrl ? { ...vq, attachment: { name: att.name, mime: att.mime, blobPath: stored } } : vq;
    // Keep the record, never a path it cannot claim (verbatim: the unowned path's record keeps name + mime only).
    return att.blobPath ? { ...vq, attachment: { name: att.name, mime: att.mime } } : vq;
  });
}

/**
 * The vendor quotes a save keeps (#143): those a live line or any revision references (a revision's
 * own stored copy wins only when no live line names it), stamped (addedAt), a vendorCompanyId kept only
 * for a live vendor company (#348), reads re-verified, attachments stored. Pure.
 */
export function vendorQuotesForSave(
  prior: Pick<Quote, "vendorQuotes" | "revisions"> | null,
  posted: VendorQuote[] | undefined,
  savedSections: SpecSection[],
  now: number,
  isVendorCompany: (id: string) => boolean,
): VendorQuote[] {
  const liveVq = vendorIdsInSections(savedSections);
  const revVq = new Set<string>();
  (prior?.revisions || []).forEach((r) => vendorIdsInSections((r.spec as { sections?: SpecSection[] } | null | undefined)?.sections).forEach((id) => revVq.add(id)));
  const keptVq = new Map<string, VendorQuote>();
  vendorQuoteRows(prior?.vendorQuotes).forEach((vq) => {
    if (revVq.has(vq.id)) keptVq.set(vq.id, vq);
  });
  (posted || []).forEach((vq) => {
    if (vq && (liveVq.has(vq.id) || revVq.has(vq.id))) keptVq.set(vq.id, vq);
  });
  const priorVq = vendorQuoteRows(prior?.vendorQuotes);
  const stamped = stampVendorQuotes(priorVq, [...keptVq.values()], now);
  const live = new Set(vendorCompanyIdsOf(stamped).filter(isVendorCompany));
  const companiesKept = vendorCompanyIdsOf(stamped).length ? keepLiveVendorCompanies(stamped, live) : stamped;
  return storeVendorQuotesOffline(verifyVendorReadsOffline(priorVq, companiesKept));
}

export type SavePlan =
  | { ok: false; error: string; refusedBeforeWrite: "document" | "boxsale" | "credit" }
  | {
      ok: true;
      patch: QuotePatch;
      savedSource: string;
      /** The sections as stored (spec.sections) — the vendor-quote pruning reads these. */
      savedSections: SpecSection[];
      credit: number;
      notice?: string;
      valueAdjusted: boolean;
    };

/**
 * Everything saveQuoteAction decides from (prior, payload) before it writes, ported in order. `tier`
 * is the server's tier resolution for the posted customer + contact; `rewriteSpec` moves the spec onto
 * renamed SKUs (#304). Pure.
 */
export function planSave(
  prior: Quote | null,
  payload: SavePayload,
  deps: { bonusRates: BonusRates; tier: { tier: string; markup: number }; rewriteSpec: <T>(spec: T) => T; /** the saver's user id and the clock (#366 stamps `by` / `at`) */ userId?: string; now?: number },
): SavePlan {
  const savedSource = sourceForSave(prior?.source, "estimator");
  const docSave = packageDocForSave(payload.document, (prior?.spec as { document?: unknown } | null | undefined)?.document);
  if (!docSave.ok) return { ok: false, error: docSave.error, refusedBeforeWrite: "document" };
  // Box goods sale (spec 2026-10-21): equipment + freight only — any labor line refuses the WHOLE save before anything is
  // written (the document refusal's shape: no id, so the edit stays visibly unsaved). An older caller (no flag) keeps the stored one.
  const boxSale = boxSaleForSave(prior, payload.boxSale);
  const boxProblem = boxSaleSaveProblem(boxSale, Array.isArray(payload.sections) ? payload.sections : []);
  if (boxProblem) return { ok: false, error: boxProblem, refusedBeforeWrite: "boxsale" };
  const isPortalCatalog = savedSource === "portal-catalog";
  const raw = Array.isArray(payload.sections) ? payload.sections.map(sanitizeSystemSell).map(withSanitizedKeyProducts).map(withSanitizedOutputFields) : payload.sections;
  const groups = sanitizeGroups(payload.groups ?? (prior?.spec as { groups?: unknown } | null | undefined)?.groups);
  const normalizedRaw = Array.isArray(raw) ? normalizeSystemOrder(raw.map(sanitizeSectionGroupMeta), groups) : raw;
  // #366: the project discounts are sanitized and stamped here (an unchanged entry keeps who set it and when; a posted by / at
  // is never trusted), then RE-APPLIED to every line and assembly part before the bonus lines (which read normal cost).
  const priorDiscounts = sanitizeProjectDiscounts((prior?.spec as { projectDiscounts?: unknown } | null | undefined)?.projectDiscounts);
  const discounts = mergeDiscountsForSave(priorDiscounts, payload.projectDiscounts !== undefined ? payload.projectDiscounts : priorDiscounts, deps.userId ?? "", deps.now ?? Date.now());
  // #368: both steps (discounts re-applied, then the bonus lines) are deriveEstimatorSections — the one function Revise's re-price runs too.
  const withBonus = Array.isArray(normalizedRaw)
    ? deriveEstimatorSections({ source: savedSource, quoteType: prior?.quoteType, status: prior ? prior.status : "draft" }, normalizedRaw, discounts, deps.bonusRates)
    : normalizedRaw;
  const credit = settleRewardCreditOffline(withBonus, prior);
  if (!credit.ok) return { ok: false, error: credit.error, refusedBeforeWrite: "credit" };
  const posted = credit.sections;
  const { sections: savedSections, anyPor, anyConfirm } = isPortalCatalog ? clearPricedPor(posted) : { sections: posted, anyPor: false, anyConfirm: false };
  const priced = reconcileEstimatorValue(posted, { value: payload.value, markup: payload.markup });
  const patch: QuotePatch = {
    name: payload.name,
    customer: payload.customer,
    customerId: payload.customerId || null,
    locationId: payload.locationId || null,
    contactName: payload.contactName || "",
    quoteNote: payload.quoteNote || "",
    assumptions: payload.assumptions || "",
    installTimeframe: payload.installTimeframe || "TBD",
    paymentTerms: payload.paymentTerms,
    category: (payload.category || "").trim(),
    value: priced.value,
    margin: priced.markup, // stored under the old field name (#367)
    pricingTier: deps.tier.tier,
    tierMargin: deps.tier.markup,
    source: savedSource,
    spec: { sections: normalizeSystemOrder(savedSections, groups), mobs: payload.mobs, groups, ...(docSave.document ? { document: docSave.document } : {}), ...(Object.keys(discounts).length ? { projectDiscounts: discounts } : {}) },
    pdfOptions: normalizePdfOptions(payload.pdfOptions),
    // Box goods sale: create keeps it via buildQuote, update() stores only true.
    boxSale,
    ...(typeof payload.coverSummary === "string" ? { coverSummary: cleanPlainText(payload.coverSummary, COVER_SUMMARY_MAX) } : {}),
    ...(typeof payload.notIncluded === "string" ? { notIncluded: cleanPlainText(payload.notIncluded, NOT_INCLUDED_MAX) } : {}),
    ...(isPortalCatalog && !anyPor && !anyConfirm ? { portalReview: null } : {}),
  };
  // #368: a sent / won / lost estimate keeps the tier stamp its lines were priced at — a customer / contact change saved on it never
  // moves the stamp under the stored lines. Server-enforced on the STORED status.
  if (prior && repriceLocked(prior.status)) {
    patch.pricingTier = prior.pricingTier ?? null;
    patch.tierMargin = prior.tierMargin ?? null;
  }
  patch.spec = deps.rewriteSpec(patch.spec);
  return { ok: true, patch, savedSource, savedSections, credit: credit.credit, ...(credit.notice ? { notice: credit.notice } : {}), valueAdjusted: priced.adjusted };
}
