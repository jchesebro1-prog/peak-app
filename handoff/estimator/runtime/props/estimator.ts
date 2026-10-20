/**
 * Estimator handoff — the EstimatorProps builder: src/app/(app)/estimator/page.tsx (EstimatorPage +
 * initialFrom) ported prop by prop onto the HandoffStore and the ports. The page's pure helpers are
 * imported; every store/settings/users read it makes becomes a read of the store's overlay over
 * the slice (stores, @/db and settings can never reach the browser bundle — the build fails if
 * they do). Server-only features are fixed off (see FIXED). Plan: PR 2 Task 3.
 */
import type { Quote, QuoteReview } from "@/lib/stores/quotes";
import type { CustomerLite, EstimatorProps, InitialQuote, PaymentTerms, SpecSection, TrackPart, TravelLite, VendorQuote } from "@/app/(app)/estimator/types";
import { DEFAULT_PACKAGE_SELECTION, normalizePackageSelection } from "@/lib/estimate-output/package-selection";
import { allAssembliesFrom } from "@/lib/fixture-assemblies";
import { fabricAreaRateOf, sewingPctFrom, SEWING_PCT_ID } from "@/lib/design/curtain-pricing";
import { isFabricPart } from "@/lib/fabric-part";
import { normalizeQuotePipeline, resolvePipelines } from "@/lib/pipelines";
import { FIXTURE_RATE_DEFAULTS, type FixtureRates } from "@/lib/fixture-rates";
import { DEFAULT_FREIGHT_RULE, FREIGHT_RATE_IDS, type FreightRule } from "@/lib/freight-rule";
import { sanitizeTrackSeriesBlob, seriesSkus, TRACK_SERIES_BLOB } from "@/lib/track-series";
import { sanitizeSystemCategories, SYSTEM_CATEGORIES_BLOB, type CategoryOption } from "@/lib/system-categories";
import { ESTIMATE_OUTPUT_BLOB, sanitizeEstimateOutputDefaults } from "@/lib/estimate-output/fields";
import { DEFAULT_PDF_OPTIONS, normalizePdfOptions } from "@/lib/quote-pdf/pdf-options";
import { documentRevStamp, pdfView } from "@/lib/quote-pdf/state";
import { pickContactName, pickVenueId, readHandoff, systemQuoteName } from "@/app/(app)/quotes/new/handoff";
import { mergedConsultingAssumptions } from "@/lib/consulting-stages";
import { quoteSentOnce } from "@/lib/quote-people-lock";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { sourceForSave } from "@/lib/portal-quote-mode";
import { normalizeSystemOrder, sanitizeGroups } from "@/lib/estimate-groups/groups";
import { sanitizePackageDoc } from "@/lib/package-doc/sanitize";
import { quoteNextStep, type QuoteNextStepView } from "@/lib/quote-next-step";
import { approvalHolds, reviewLimitChip, reviewLimitsFrom, type ReviewLimitContext } from "@/lib/review-limits";
import { can as roleCan } from "@/lib/team";
import type { HandoffStore } from "../store";
import { blobData, customers as customerPort, refreshPortsFromStore, resolveTierFor, settingsView, users, type TeamUser } from "../ports";
import { bonusRatesNow, bySkuResolver, generalRate, listIntrosLocal, liveCatalog, listFixtures } from "../readers";

export { bySkuResolver };

/** The page's server-only props, fixed for the prototype (spec: no Blob, no Assist, no tasks/templates/spec records). */
export const FIXED = {
  blobUploads: false,
  vendorPdfEnabled: false,
  aiSource: null,
  assistDraft: null,
  suggestion: null,
  suggestionParts: {},
  quoteTasks: [],
  templateSets: [],
  specKeys: [],
  portalStatusError: null,
  canApplyCredit: false,
} satisfies Partial<EstimatorProps>;

type QuoteDoc = Omit<Partial<Quote>, "spec"> & {
  id: string;
  contactName?: string;
  quoteNote?: string;
  assumptions?: string;
  paymentTerms?: PaymentTerms;
  spec?: { sections?: unknown; mobs?: unknown; groups?: unknown; document?: unknown } | null;
};

const rvNone = (): QuoteReview => ({ state: "none", reviewer: null, submittedBy: null, submittedAt: null, decidedBy: null, decidedAt: null, note: "" });

/** Prototype constructor defaults (used only when no quote record exists). */
const FALLBACK = { quoteId: "New estimate", projectName: "New estimate", custName: "", quoteNote: "", assumptions: "" };

/** page.tsx vendorQuotesOf — vendor quotes ride top-level on the doc. */
function vendorQuotesOf(q: QuoteDoc | null): VendorQuote[] {
  const raw = (q as { vendorQuotes?: unknown } | null)?.vendorQuotes;
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is VendorQuote => !!v && typeof v === "object" && typeof (v as VendorQuote).id === "string");
}

/** page.tsx initialFrom, with customers.ts resolveId → ports.customers.resolve. */
function initialFrom(q: QuoteDoc | null, customers: CustomerLite[], userName: string, systemCategories: CategoryOption[], now: number): InitialQuote {
  if (!q) {
    return {
      systemCategories, loadedId: null, quoteId: FALLBACK.quoteId, status: "draft", review: rvNone(), quoteType: null, pipelineId: null, stage: null,
      projectName: FALLBACK.projectName, custName: FALLBACK.custName, customerId: null, locationId: null, contactName: "",
      quoteNote: FALLBACK.quoteNote, assumptions: FALLBACK.assumptions, installTimeframe: "TBD", paymentTerms: "Unknown", category: "",
      owner: userName, preparedBy: userName, revNum: 1, revDateMs: now, pricingTier: null, tierMargin: null, sections: null, groups: [],
      document: null, vendorQuotes: [], replaces: "", pdfOptions: { ...DEFAULT_PDF_OPTIONS }, pdf: null, coverSummary: "", notIncluded: null,
      packageSelection: { ...DEFAULT_PACKAGE_SELECTION, excludedDatasheets: [] }, portal: null, bonusSource: "estimator", bonusQuoteType: "system",
      clientResponses: null, bonusRecord: null, estimatorBonusSplit: null, leadId: null,
    };
  }
  const cid = q.customerId || customerPort.resolve(q.customer)?.id || null;
  const crec = cid ? customers.find((c) => c.id === cid) : undefined;
  const cname = cid ? crec?.name || q.customer || FALLBACK.custName : q.customer || FALLBACK.custName;
  let locId = q.locationId || null;
  if (cid && !locId && crec) {
    const prim = crec.locations.find((l) => l.primary) || crec.locations[0] || null;
    locId = prim?.id || null;
  }
  let contactName = q.contactName;
  const conts = crec?.contacts || [];
  if (contactName == null) {
    const pc = conts.find((c) => c.primary) || conts[0] || null;
    contactName = pc ? pc.name : "";
  } else if (contactName && conts.length && !conts.some((c) => c.name === contactName)) {
    const pc = conts.find((c) => c.primary) || conts[0];
    contactName = pc ? pc.name : "";
  }
  const spec = q.spec;
  const groups = sanitizeGroups(spec?.groups);
  const sections = spec && Array.isArray(spec.sections) && spec.sections.length ? normalizeSystemOrder(spec.sections as SpecSection[], groups) : null;
  return {
    systemCategories,
    loadedId: q.id,
    quoteId: displayQuoteNumber(q),
    status: q.status ?? "draft",
    review: q.review || rvNone(),
    quoteType: q.quoteType ?? null,
    pipelineId: q.pipelineId ?? null,
    stage: q.stage ?? null,
    projectName: q.name || FALLBACK.projectName,
    custName: cname,
    customerId: cid,
    locationId: locId,
    contactName: contactName || "",
    quoteNote: q.quoteNote != null ? q.quoteNote : FALLBACK.quoteNote,
    assumptions: q.assumptions != null ? q.assumptions : "",
    installTimeframe: q.installTimeframe || "TBD",
    paymentTerms: q.paymentTerms || "Unknown",
    category: q.category || "",
    owner: q.owner || "",
    preparedBy: q.preparedBy || "",
    revNum: documentRevStamp(q as Quote).revNum,
    revDateMs: q.updatedAt || now,
    pricingTier: q.pricingTier ?? null,
    tierMargin: q.tierMargin ?? null,
    sections,
    groups,
    document: sanitizePackageDoc(spec?.document),
    vendorQuotes: vendorQuotesOf(q),
    replaces: "",
    pdfOptions: normalizePdfOptions(q.pdfOptions),
    pdf: pdfView(q.pdf, now),
    coverSummary: q.coverSummary || "",
    notIncluded: typeof q.notIncluded === "string" ? q.notIncluded : null,
    packageSelection: normalizePackageSelection(q.packageSelection),
    bonusSource: sourceForSave(q.source, "estimator"),
    bonusQuoteType: q.quoteType ?? "system",
    clientResponses: q.clientResponses ?? null,
    bonusRecord: q.bonusRecord ?? null,
    estimatorBonusSplit: q.estimatorBonusSplit ?? null,
    leadId: q.leadId || null,
    portal:
      q.source === "portal-catalog"
        ? {
            quoteId: q.id,
            portalFirm: q.portalFirm ?? null,
            portalReview: q.portalReview ?? null,
            portalAcceptance: q.portalAcceptance ?? null,
            portalDecline: q.portalDecline ?? null,
            porItems: (sections || []).flatMap((s) => s.items.filter((it) => it.por).map((it) => ({ desc: it.desc, qty: it.qty }))),
            confirmItems: (sections || []).flatMap((s) => s.items.filter((it) => it.portalConfirm).map((it) => ({ desc: it.desc, qty: it.qty }))),
            back: `/estimator?id=${encodeURIComponent(q.id)}`,
          }
        : null,
  };
}

/** stores/quotes timeAgo. */
function timeAgo(ts: number | null | undefined, now: number): string {
  if (!ts) return "—";
  const diff = now - ts;
  const d = Math.floor(diff / 86_400_000);
  if (d <= 0) {
    const h = Math.floor(diff / 3600000);
    return h <= 0 ? "just now" : h + "h ago";
  }
  if (d === 1) return "yesterday";
  if (d < 14) return d + "d ago";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** quote-next-step-server quoteNextStepFor, over the ports' roster and the settings' review limits. */
export function nextStepFor(q: QuoteDoc, viewer: TeamUser, roster: TeamUser[], reviewLimits: unknown, now: number): QuoteNextStepView {
  const ctx: ReviewLimitContext = {
    limits: reviewLimitsFrom(reviewLimits),
    roster: roster.map((u) => ({ id: u.id, name: u.name, status: u.status ?? "active", canApprove: roleCan("approve", u.roles) })),
  };
  const quote = q as unknown as Quote;
  return quoteNextStep({
    status: quote.status,
    review: quote.review ?? null,
    holds: approvalHolds(quote, ctx),
    chip: reviewLimitChip(quote, ctx, viewer.name),
    owner: (q.owner || q.preparedBy || "").trim(),
    viewer: viewer.name,
    viewerCanApprove: roleCan("approve", viewer.roles),
    viewerCanCreate: roleCan("create", viewer.roles),
    viewerCanSend: roleCan("send", viewer.roles),
    submittedAgo: q.review?.submittedAt ? timeAgo(q.review.submittedAt, now) : "",
    reviewers: roster.filter((u) => roleCan("approve", u.roles)).map((u) => u.name),
    asOf: typeof q.updatedAt === "number" ? q.updatedAt : 0,
  });
}

/** Converts URLSearchParams into the page's searchParams record (repeated keys → arrays). */
function spRecord(search: URLSearchParams): Record<string, string | string[] | undefined> {
  const out: Record<string, string | string[] | undefined> = {};
  for (const k of new Set(search.keys())) {
    const all = search.getAll(k);
    out[k] = all.length > 1 ? all : all[0];
  }
  return out;
}

/**
 * Props for <EstimatorClient> — the prototype's EstimatorPage. `quoteId` null (or unknown) opens a
 * clean, unsaved estimate seeded from the intake hand-off params in `search` (?customer=, ?venue=,
 * ?contact=, ?category=, ?name=, ?replaces=, ?lead=), exactly as the page does.
 */
export async function buildEstimatorProps(store: HandoffStore, quoteId: string | null, search: URLSearchParams): Promise<EstimatorProps> {
  await refreshPortsFromStore(store);
  const now = Date.now();
  const user = users.current();
  const sp = spRecord(search);
  const handoff = quoteId ? null : readHandoff(sp);
  const preCustomer = handoff?.customerId || undefined;
  const preCategory = handoff?.category || undefined;

  const settings = settingsView();
  const pipelines = resolvePipelines(settings as Parameters<typeof resolvePipelines>[0]);
  // stores/quotes get(): a quote reads with its pipeline and a stage matching its status (legacy keys convert here).
  // `get` hands back a copy, so normalizing in place never touches the store.
  const raw = quoteId ? await store.get<QuoteDoc>("quotes", quoteId) : undefined;
  const q = raw ? normalizeQuotePipeline(raw as QuoteDoc & { status: string }, pipelines) : null;
  // The page redirects a service quote to its own builder (estimatorShouldRedirect); the slice holds system estimates only.
  // The catalog collection is live parts only: retired-SKU stubs live in store.catalogRenames, for the resolver alone.
  const catalogRows = await liveCatalog(store);
  const fixtures = await listFixtures(store, settings);
  const roster = users.all();
  const fixtureRates: FixtureRates = { ...FIXTURE_RATE_DEFAULTS, ...(blobData("fixture_rates") as Partial<FixtureRates>) };
  const general = blobData("pricing_rules");
  const curtainSewingPct = sewingPctFrom(general[SEWING_PCT_ID]);
  const bonusRates = bonusRatesNow();
  const freightRule: FreightRule = {
    basePct: generalRate(FREIGHT_RATE_IDS.base, DEFAULT_FREIGHT_RULE.basePct),
    stepMiles: generalRate(FREIGHT_RATE_IDS.stepMiles, DEFAULT_FREIGHT_RULE.stepMiles),
    stepPct: generalRate(FREIGHT_RATE_IDS.stepPct, DEFAULT_FREIGHT_RULE.stepPct),
    capPct: generalRate(FREIGHT_RATE_IDS.cap, DEFAULT_FREIGHT_RULE.capPct),
  };
  const trackSeries = sanitizeTrackSeriesBlob(blobData(TRACK_SERIES_BLOB));
  // The intro library as the store holds it (Task 5: the narrative actions write the `intros` collection).
  const narrativeIntros = await listIntrosLocal(store);
  const estimateOutputDefaults = sanitizeEstimateOutputDefaults(blobData(ESTIMATE_OUTPUT_BLOB));

  // Phase 6 categories, each typical part resolved against the live catalog (fail-soft → Blank only).
  const liveBySku = bySkuResolver(catalogRows, store.catalogRenames);
  let systemCategories: CategoryOption[] = [];
  try {
    systemCategories = sanitizeSystemCategories(blobData(SYSTEM_CATEGORIES_BLOB)).map((c) => ({
      id: c.id,
      name: c.name,
      ...(c.discipline ? { discipline: c.discipline } : {}),
      items: c.items.map((i) => {
        const p = liveBySku(i.sku);
        return {
          sku: i.sku,
          qty: i.qty,
          ...(i.note ? { note: i.note } : {}),
          part: p ? { sku: p.sku, desc: p.desc || p.sku, unit: p.unit || "ea", cost: Number(p.cost) || 0, list: Number(p.list) || 0 } : null,
        };
      }),
    }));
  } catch (e) {
    console.warn("[handoff] system categories unavailable — Add a system offers Blank only", e);
  }

  const fabrics = catalogRows
    .filter(isFabricPart)
    .map((p) => ({ sku: p.sku, name: p.desc, costPerSqft: p.costPerSqft ?? 0, curtainAreaRate: fabricAreaRateOf(p) }))
    .filter((f) => f.curtainAreaRate > 0);
  const vendorNames = Array.from(new Set(catalogRows.map((p) => (p.mfr || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const trackSkus = new Set(trackSeries.flatMap((s) => seriesSkus(s)));
  const trackParts: Record<string, TrackPart> = {};
  for (const p of catalogRows) {
    if (!trackSkus.has(p.sku)) continue;
    trackParts[p.sku] = { sku: p.sku, desc: p.desc || "", cost: Number(p.cost) || 0, list: Number(p.list) || 0, unit: p.unit || "ea", mfr: p.mfr || "" };
  }
  const laborRates: Record<string, number> = {};
  for (const p of catalogRows) if (p.category === "Labor") laborRates[p.sku] = p.cost;

  const customers = customerPort.all();
  const initial = initialFrom(q, customers, user.name, systemCategories, now);

  // Intake hand-off seeding (a new estimate only; no suggestions in the prototype).
  const seedCustomer = preCustomer;
  if (seedCustomer) {
    const cust = customers.find((c) => c.id === seedCustomer);
    if (cust) {
      initial.customerId = cust.id;
      initial.custName = cust.name;
      initial.locationId = pickVenueId(cust, handoff?.venueId || "") || null;
      initial.contactName = pickContactName(cust, handoff?.contactName || "");
    }
  }
  if (!q) initial.leadId = handoff?.leadId || null;
  if (preCategory && preCategory.trim()) initial.category = preCategory.trim();
  if (handoff) {
    initial.projectName = handoff.name || (initial.customerId ? systemQuoteName(initial.custName, initial.category) : initial.projectName);
    initial.replaces = handoff.replaces;
  }
  if (!q) {
    const t = resolveTierFor(initial.customerId, initial.contactName);
    initial.pricingTier = t.tier;
    initial.tierMargin = t.margin;
  }

  // Travel seed for the loaded selection only (page.tsx E3/E4).
  const travel: Record<string, TravelLite> = {};
  if (initial.customerId) {
    travel[initial.customerId + "|" + (initial.locationId || "")] = customerPort.travelFor(initial.locationId || null, initial.customerId);
  } else if (initial.custName) {
    const id = customerPort.resolve(initial.custName)?.id;
    travel["name|" + initial.custName] = id ? customerPort.travelFor(null, id) : { miles: null, minutes: null, officeName: null };
  }

  const next = q ? nextStepFor(q, user, roster, settings.reviewLimits, now) : null;
  const can = (perm: "create" | "approve") => roleCan(perm, user.roles);

  return {
    initial,
    vendorFromThread: null,
    pipelines,
    companyName: (settings.companyName as string) || "Peak Systems Group",
    logoDark: (settings.logoDark as string) || null,
    fabrics,
    curtainSewingPct,
    trackSeries,
    trackParts,
    laborRates,
    fixtureRates,
    fixtureAssemblies: allAssembliesFrom(fixtures, catalogRows),
    vendors: vendorNames,
    customers,
    travel,
    next,
    people: roster.map((u) => ({ id: u.id, name: u.name })),
    assumptionLibrary: mergedConsultingAssumptions(settings.consultingAssumptions as never),
    freightRule,
    viewerName: user.name,
    viewerCanApprove: can("approve"),
    peopleSentOnce: quoteSentOnce(q as Quote | null),
    bonusRates,
    viewerRoles: user.roles ?? [],
    canWriteNarrativeLibrary: can("create"),
    narrativeIntros,
    notIncludedDefault: estimateOutputDefaults.notIncluded,
    ...FIXED,
  };
}
