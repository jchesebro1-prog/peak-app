import { DEFAULT_PACKAGE_SELECTION, normalizePackageSelection } from "@/lib/estimate-output/package-selection";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { get as getQuote, type Quote, type QuoteReview } from "@/lib/stores/quotes";
import { quoteBuilderHref, estimatorShouldRedirect } from "@/lib/quote-links";
import { byCategory, fabricParts, getManyBySku, list as catalogList } from "@/lib/stores/catalog";
import { allAssembliesFrom } from "@/lib/fixture-assemblies";
import { listFixtures } from "@/lib/stores/fixtures";
import { fabricAreaRateOf } from "@/lib/design/curtain-pricing";
import {
  all as allCustomers,
  resolveId,
  travelForId,
  travelForName,
  type CustomerDoc,
} from "@/lib/stores/customers";
import { activeUsers } from "@/lib/users";
import { getSettings, type Office } from "@/lib/settings";
import { loadPipelines } from "@/lib/pipelines-server";
import { get as getSurvey } from "@/lib/stores/surveys";
import { get as getInspection } from "@/lib/stores/inspections";
import { getFixtureRates, loadBonusRates, loadCurtainSewingPct } from "@/lib/stores/pricing";
import { loadFreightRule } from "@/lib/freight-rule-load";
import { allSpecRecords } from "@/lib/stores/spec-records";
import { listTrackSeries } from "@/lib/stores/track-series";
import { getSystemCategories } from "@/lib/stores/system-categories";
import type { CategoryOption } from "@/lib/system-categories";
import { listIntros } from "@/lib/stores/narrative-intros";
import { seriesSkus } from "@/lib/track-series";
import { systemMatchKeys } from "@/lib/specs/records";
import { blobEnabled } from "@/lib/blob";
import { DEFAULT_PDF_OPTIONS, normalizePdfOptions } from "@/lib/quote-pdf/pdf-options";
import { tasksForQuote } from "@/lib/stores/tasks";
import { resolveTier } from "@/lib/pricing-tiers";
import { taskTemplateSetsFor } from "@/lib/stores/task-templates";
import { pickContactName, pickVenueId, readHandoff, systemQuoteName } from "@/app/(app)/quotes/new/handoff";
import { mergedConsultingAssumptions } from "@/lib/consulting-stages";
import { documentRevStamp, pdfView } from "@/lib/quote-pdf/state";
import { quoteSentOnce } from "@/lib/quote-people-lock";
import EstimatorClient from "./estimator-client";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { sourceForSave } from "@/lib/portal-quote-mode";
import { normalizeSystemOrder, sanitizeGroups } from "@/lib/estimate-groups/groups";
import { sanitizePackageDoc } from "@/lib/package-doc/sanitize";
import { getEstimateOutputDefaults } from "@/lib/stores/estimate-output-defaults";
import ActionError from "@/components/action-error";
import { quoteNextStepFor } from "@/lib/quote-next-step-server";
import { assistDraftViewOf } from "@/lib/assist/features/estimate-draft";
import { getSuggestion, suggestionForQuote } from "@/lib/stores/estimate-suggestions";
import { suggestionViewOf, unlinkedRetryAllowed, type EstimateSuggestionView, type SuggestionParts } from "@/lib/assist/features/suggestion-panel";
import type { EstimateSuggestion } from "@/lib/assist/features/suggestion";
import type {
  AiSource,
  CustomerLite,
  InitialQuote,
  PaymentTerms,
  SpecSection,
  TrackPart,
  TravelLite,
  VendorQuote,
} from "./types";

export const metadata = { title: "Estimator — Quartzite-6" };
/** #210: this page's first listFixtures() can run the one-time fixture
 *  conversion under its 15 s budget (FIXTURES_CONVERT_BUDGET_MS). #222: its
 *  saves render the saved quote PDF in `after()`, inside this budget — 120 s
 *  (fix wave 1) leaves a cold Chromium start room to finish. */
export const maxDuration = 120;

/**
 * Estimator — detailed line-item quote builder (port of Estimator.dc.html).
 * /estimator?id=Q-#### loads that quote. With no id (or an unknown id), the
 * builder opens a clean unsaved estimate; Save creates the quote.
 */

function rvNone(): QuoteReview {
  return {
    state: "none",
    reviewer: null,
    submittedBy: null,
    submittedAt: null,
    decidedBy: null,
    decidedAt: null,
    note: "",
  };
}

/** Prototype constructor defaults (used only when no quote record exists). */
const FALLBACK = {
  quoteId: "New estimate",
  projectName: "New estimate",
  custName: "",
  quoteNote: "",
  assumptions: "",
};

type QuoteDoc = Quote & {
  contactName?: string;
  quoteNote?: string;
  assumptions?: string;
  paymentTerms?: PaymentTerms;
  spec?: { sections?: unknown; mobs?: unknown; groups?: unknown; document?: unknown } | null;
};

/**
 * Vendor quotes ride TOP-LEVEL on the doc (#143), typed `unknown` on Quote —
 * narrow them here. The attachment is handed over whole, including the local
 * data-URL when Blob storage is off: it is the only copy of the file, and a
 * save round-trips whatever the builder holds.
 */
function vendorQuotesOf(q: QuoteDoc | null): VendorQuote[] {
  const raw = q?.vendorQuotes;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (v): v is VendorQuote => !!v && typeof v === "object" && typeof (v as VendorQuote).id === "string"
  );
}

/** Resolve the loaded quote's customer link + header fields (port of loadFromUrl). */
async function initialFrom(
  q: QuoteDoc | null,
  customers: CustomerLite[],
  userName: string,
  systemCategories: CategoryOption[]
): Promise<InitialQuote> {
  if (!q) {
    return {
      systemCategories,
      loadedId: null,
      quoteId: FALLBACK.quoteId,
      status: "draft",
      review: rvNone(),
      quoteType: null,
      pipelineId: null,
      stage: null,
      projectName: FALLBACK.projectName,
      custName: FALLBACK.custName,
      customerId: null,
      locationId: null,
      contactName: "",
      quoteNote: FALLBACK.quoteNote,
      assumptions: FALLBACK.assumptions,
      installTimeframe: "TBD",
      paymentTerms: "Unknown",
      category: "",
      owner: userName,
      // #287 task B: a new quote is prepared by its creator (buildQuote's default).
      preparedBy: userName,
      revNum: 1,
      revDateMs: Date.now(),
      pricingTier: null,
      tierMargin: null,
      sections: null,
      groups: [],
      document: null,
      vendorQuotes: [],
      replaces: "",
      pdfOptions: { ...DEFAULT_PDF_OPTIONS },
      pdf: null,
      coverSummary: "",
      notIncluded: null,
      packageSelection: { ...DEFAULT_PACKAGE_SELECTION, excludedDatasheets: [] },
      portal: null,
      bonusSource: "estimator",
      bonusQuoteType: "system",
      clientResponses: null,
      bonusRecord: null,
      estimatorBonusSplit: null,
      leadId: null,
    };
  }
  const cid = q.customerId || (await resolveId(q.customer)) || null;
  const crec = cid ? customers.find((c) => c.id === cid) : undefined;
  const cname = cid ? crec?.name || q.customer || FALLBACK.custName : q.customer || FALLBACK.custName;
  let locId = q.locationId || null;
  if (cid && !locId && crec) {
    const prim = crec.locations.find((l) => l.primary) || crec.locations[0] || null;
    locId = prim?.id || null;
  }
  // resolve the "attn" contact: stored on the quote, else the customer's primary contact
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
  // Phase 2a: stored groups, cleaned; systems normalised into group order (unknown groupId dropped).
  const groups = sanitizeGroups(spec?.groups);
  const sections =
    spec && Array.isArray(spec.sections) && spec.sections.length
      ? normalizeSystemOrder(spec.sections as SpecSection[], groups)
      : null;
  return {
    systemCategories,
    loadedId: q.id,
    // #223: the header label — the estimate number; `loadedId` stays the key.
    quoteId: displayQuoteNumber(q),
    status: q.status,
    review: q.review || rvNone(),
    // Normalized on read by the quotes store (normalizeQuotePipeline) — a
    // system quote always reads with a pipeline + stage that agree with its
    // status; a service quote (quoteType set to something else) reads null.
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
    // #287 task B: the stored names — the Lead estimator / Prepared by
    // selects show who is on the quote, never the viewer standing in for a
    // blank (a blank prints the owner, then the company, on the document).
    owner: q.owner || "",
    preparedBy: q.preparedBy || "",
    // The printed Rev (Jeff 2026-10-15 #13): the send number — the latest
    // send's on a sent quote, the next send's on a draft — the PDF's own rule.
    revNum: documentRevStamp(q).revNum,
    revDateMs: q.updatedAt || Date.now(),
    // Item 11 (D87): stamped tier seeds labor/curtain margins client-side.
    pricingTier: q.pricingTier ?? null,
    tierMargin: q.tierMargin ?? null,
    sections,
    groups,
    // Estimator Phase 5 — the Build package document, re-validated on read.
    document: sanitizePackageDoc(spec?.document),
    vendorQuotes: vendorQuotesOf(q),
    replaces: "",
    pdfOptions: normalizePdfOptions(q.pdfOptions),
    pdf: pdfView(q.pdf, Date.now()),
    // #301: the cover fields as stored; null = never stored (the editor starts from the default list).
    coverSummary: q.coverSummary || "",
    notIncluded: typeof q.notIncluded === "string" ? q.notIncluded : null,
    // #333: the Client package selection, normalised on read (absent = defaults).
    packageSelection: normalizePackageSelection(q.packageSelection),
    // #245 Task 13: the staff Portal panel — present only for a portal-
    // catalog quote. porItems is a point-in-time read of the loaded spec's
    // `por` lines; the next Save recomputes what remains (clearPricedPor).
    // Estimator bonuses: judge the source the next save will write (a grid
    // quote saves as "estimator"), the same as saveQuoteAction's canonicalizer.
    bonusSource: sourceForSave(q.source, "estimator"),
    bonusQuoteType: q.quoteType ?? "system",
    clientResponses: q.clientResponses ?? null,
    bonusRecord: q.bonusRecord ?? null,
    estimatorBonusSplit: q.estimatorBonusSplit ?? null,
    // Estimate suggestion: the stored lead, display-only — a save never changes it.
    leadId: q.leadId || null,
    portal:
      q.source === "portal-catalog"
        ? {
            quoteId: q.id,
            portalFirm: q.portalFirm ?? null,
            portalReview: q.portalReview ?? null,
            portalAcceptance: q.portalAcceptance ?? null,
            portalDecline: q.portalDecline ?? null,
            porItems: (sections || []).flatMap((s) =>
              s.items.filter((it) => it.por).map((it) => ({ desc: it.desc, qty: it.qty }))
            ),
            // #250: priced curtains still waiting on Peak's confirmation.
            confirmItems: (sections || []).flatMap((s) =>
              s.items.filter((it) => it.portalConfirm).map((it) => ({ desc: it.desc, qty: it.qty }))
            ),
            back: `/estimator?id=${encodeURIComponent(q.id)}`,
          }
        : null,
  };
}

/**
 * Estimate suggestion (spec 2026-10-13 §2): the suggestion this estimate shows
 * in its Suggested BOM panel — `?suggestion=` on a new estimate, else the one a
 * saved quote was built from — and the live part behind each of its skus,
 * keyed by the suggestion's OWN sku (getManyBySku follows renames). Fail-soft:
 * a blob or catalog read error just means no panel.
 */
async function loadSuggestion(
  suggestionId: string,
  quote: { id: string; createdAt?: number | null; customerId?: string | null } | null
): Promise<{ record: EstimateSuggestion | null; view: EstimateSuggestionView | null; parts: SuggestionParts }> {
  try {
    let record: EstimateSuggestion | null = null;
    let linked = false;
    if (quote) {
      record = await suggestionForQuote(quote.id);
      linked = !!record;
      // The first save's link didn't land but the URL still names the
      // suggestion (stepSearch keeps ?suggestion= after the first save): show
      // it unlinked, so the next save retries the link — never a write here.
      // unlinkedRetryAllowed keeps a crafted URL off older / other-customer quotes.
      if (!record && suggestionId) {
        const s = await getSuggestion(suggestionId);
        if (s && unlinkedRetryAllowed(s, quote)) record = s;
      }
    } else if (suggestionId) {
      record = await getSuggestion(suggestionId);
    }
    if (!record) return { record: null, view: null, parts: {} };
    const skus = [...new Set(record.systems.flatMap((sys) => sys.lines.filter((l) => !l.custom && l.sku).map((l) => l.sku)))];
    const found = skus.length ? await getManyBySku(skus) : new Map();
    const parts: SuggestionParts = {};
    for (const sku of skus) {
      const p = found.get(sku);
      if (p) parts[sku] = { sku: p.sku, desc: p.desc || p.sku, unit: p.unit || "ea", cost: Number(p.cost) || 0, list: Number(p.list) || 0 };
    }
    return { record, view: suggestionViewOf(record, linked), parts };
  } catch (e) {
    console.warn("[estimator] suggestion unavailable — no Suggested BOM panel", e);
    return { record: null, view: null, parts: {} };
  }
}

/** Estimator Phase 6 — the admin-set categories with each item's live catalog part (live sku, desc, unit, cost, list). */
async function loadSystemCategoryOptions(): Promise<CategoryOption[]> {
  // Fail-soft: a categories/catalog read error must never take the Estimator down, so the modal just offers Blank system.
  return loadSystemCategoryOptionsUnsafe().catch((e) => {
    console.warn("[estimator] system categories unavailable — Add a system offers Blank only", e);
    return [];
  });
}
async function loadSystemCategoryOptionsUnsafe(): Promise<CategoryOption[]> {
  const categories = await getSystemCategories();
  const skus = [...new Set(categories.flatMap((c) => c.items.map((i) => i.sku)))];
  const found = skus.length ? await getManyBySku(skus) : new Map();
  return categories.map((c) => ({
    id: c.id,
    name: c.name,
    ...(c.discipline ? { discipline: c.discipline } : {}),
    items: c.items.map((i) => {
      const p = found.get(i.sku);
      return {
        sku: i.sku,
        qty: i.qty,
        ...(i.note ? { note: i.note } : {}),
        part: p ? { sku: p.sku, desc: p.desc || p.sku, unit: p.unit || "ea", cost: Number(p.cost) || 0, list: Number(p.list) || 0 } : null,
      };
    }),
  }));
}

export default async function EstimatorPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const rawId = Array.isArray(sp.id) ? sp.id[0] : sp.id;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  // #245 Task 13: the Portal panel's Approve button reuses the Quotes-hub
  // status action verbatim (setQuoteStatus) — a gate refusal redirects back
  // here with ?statusError=; surfaced in the panel, cleared on the next load.
  const portalStatusError = one(sp.statusError) || null;
  // Guided intake hand-off (quotes/new, #160): only applies to a fresh
  // builder — an explicit ?id= always wins.
  const handoff = rawId ? null : readHandoff(sp);
  const preCustomer = handoff?.customerId || undefined;
  // #110: the intake's "Custom category" card hands its name over the same way.
  const preCategory = handoff?.category || undefined;

  /* ---- Scope draft source (S12/D83 — rules-based): resolve the linked
     survey/inspection. ?surveyId= / ?inspectionId= links the source; we
     resolve a friendly label so the client can render the Draft-scope
     affordance (assembly happens server-side in draftQuoteScopeAction). */
  let aiSource: AiSource | null = null;
  {
    const surveyId = one(sp.surveyId);
    const inspectionId = one(sp.inspectionId);
    if (surveyId) {
      const s = await getSurvey(surveyId);
      if (s) aiSource = { kind: "survey", id: s.id, label: s.venue || s.customer || s.id };
    } else if (inspectionId) {
      const ins = await getInspection(inspectionId);
      if (ins)
        aiSource = { kind: "inspection", id: ins.id, label: ins.venue || ins.customer || ins.id };
    }
  }

  const q = (rawId ? await getQuote(rawId) : null) as QuoteDoc | null;
  // #221: a quote created by a different builder (flame test, repair,
  // inspection, consulting, rental) opens its own builder, not the
  // Estimator — this is the server-side backstop behind every link fix.
  if (q && estimatorShouldRedirect(q)) redirect(quoteBuilderHref(q));
  // Estimate suggestion: the hand-off's `?suggestion=` (new estimate), else the
  // saved quote's linked one (else, unlinked, the one its URL still names).
  // Read inside the Promise.all below so an Estimator open doesn't wait on it serially.

  const [suggestion, fabricRows, laborRows, customerDocs, settings, fixtureRates, roster, catalogRows, pipelines, fixtures, curtainSewingPct, freightRule, specRecords, trackSeries, narrativeIntros, estimateOutputDefaults, systemCategories] =
    await Promise.all([
      loadSuggestion(readHandoff(sp).suggestionId, q),
      fabricParts(),
      byCategory("Labor"),
      allCustomers(),
      getSettings(),
      getFixtureRates(),
      activeUsers(),
      catalogList(),
      loadPipelines(),
      listFixtures(),
      loadCurtainSewingPct(),
      loadFreightRule(),
      allSpecRecords(),
      listTrackSeries(),
      listIntros(),
      getEstimateOutputDefaults(),
      loadSystemCategoryOptions(),
    ]);
  // PUNCHLIST #17 remainder — this quote's tasks (empty until the quote is
  // saved once; q.id is only real once a doc exists to key tasks off of).
  const quoteTasks = q ? await tasksForQuote(q.id) : [];
  // D149/#118 — reusable task-template sets applicable to quotes, for the
  // "Apply template" control next to the Tasks card.
  const templateSets = await taskTemplateSetsFor("quote");

  // Only catalog fabrics with a $/sq ft rate feed the curtain configurator
  // (#227: fabricAreaRateOf — the catalog rate, a seed, or cost per sq ft —
  // fabric cost only; the modal adds curtainSewingPct on top, #227 late).
  // #264: fabricParts() includes Theatrical/Soft Goods sold per sq ft, whose
  // rate falls back to their per-sq-ft `cost`.
  // Imported per-unit fabric rows with no rate would otherwise show up as
  // $0/sq ft options. curtainAreaRate carries the RESOLVED rate, so the
  // modal's label and computeCurtain read the same number.
  const fabrics = fabricRows
    .map((p) => ({
      sku: p.sku,
      name: p.desc,
      costPerSqft: p.costPerSqft ?? 0,
      curtainAreaRate: fabricAreaRateOf(p),
    }))
    .filter((f) => f.curtainAreaRate > 0);
  // #143: distinct catalog manufacturers seed the vendor-name datalist — no
  // new server action, the catalog rows are already loaded for the fixture
  // assemblies.
  const vendorNames = Array.from(
    new Set(catalogRows.map((p) => (p.mfr || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  // #274: the live catalog part behind every SKU a track series maps (the
  // catalog rows are already loaded); a mapped SKU absent here was deleted,
  // and the track modal treats it as unmapped.
  const trackSkus = new Set(trackSeries.flatMap((s) => seriesSkus(s)));
  const trackParts: Record<string, TrackPart> = {};
  for (const p of catalogRows) {
    if (!trackSkus.has(p.sku)) continue;
    trackParts[p.sku] = { sku: p.sku, desc: p.desc || "", cost: Number(p.cost) || 0, list: Number(p.list) || 0, unit: p.unit || "ea", mfr: p.mfr || "" };
  }

  const laborRates: Record<string, number> = {};
  laborRows.forEach((p) => {
    laborRates[p.sku] = p.cost;
  });

  const customers: CustomerLite[] = customerDocs.map((c: CustomerDoc) => ({
    id: c.id,
    name: c.name,
    locations: (c.locations || []).map((l) => ({
      id: l.id || "",
      label: l.label || "",
      city: l.city || "",
      primary: !!l.primary,
    })),
    contacts: (c.contacts || []).map((ct) => ({
      name: ct.name,
      role: ct.role || "",
      primary: !!ct.primary,
    })),
  }));

  // Phase 6: the Add a system modal's categories, each typical part resolved against the live catalog
  // (a retired SKU follows its rename; a part that left the catalog is `part: null`). Read-only.
  const initial = await initialFrom(q, customers, user.name, systemCategories);

  // Estimate suggestion: the suggestion's header fills only what the URL left
  // blank (customer, venue, contact, lead, name) — a new estimate only.
  const sugg = !q && handoff?.suggestionId ? suggestion.record : null;
  const seedCustomer = preCustomer || sugg?.customerId || undefined;
  // Venue, contact and lead come from the suggestion only when it is about the customer being seeded.
  const suggSameCustomer = !!sugg && (sugg.customerId || undefined) === seedCustomer;
  const seedVenue = handoff?.venueId || (suggSameCustomer ? sugg?.venueId || "" : "");
  const seedContact = handoff?.contactName || (suggSameCustomer ? sugg?.contactName || "" : "");
  // Seed the customer/venue/contact picked in the guided intake (quotes/new).
  // A venue/contact not on the customer falls back to its primary (#160).
  if (seedCustomer) {
    const cust = customers.find((c) => c.id === seedCustomer);
    if (cust) {
      initial.customerId = cust.id;
      initial.custName = cust.name;
      initial.locationId = pickVenueId(cust, seedVenue) || null;
      initial.contactName = pickContactName(cust, seedContact);
    }
  }
  if (!q) initial.leadId = handoff?.leadId || (suggSameCustomer ? sugg?.leadId : null) || null;
  if (preCategory && preCategory.trim()) initial.category = preCategory.trim();
  if (handoff) {
    // #160: the intake's optional name, else "<Customer> — System" (or
    // "— <category>") instead of the old static "New estimate".
    initial.projectName = handoff.name || sugg?.quoteName || (initial.customerId ? systemQuoteName(initial.custName, initial.category) : initial.projectName);
    initial.replaces = handoff.replaces;
  }

  // #254 fix wave 2: a NEW estimate opens at its customer's tier — the
  // intake's ?customer=/&contact= (quotes/new, Inbox newQuoteHref) or, with
  // no customer, Base per Estimating Rules — so lines seed at the margin the
  // first Save will stamp (saveQuoteAction resolves the same customer +
  // contact). A loaded quote keeps its own stored stamp.
  if (!q) {
    const t = await resolveTier(initial.customerId, initial.contactName);
    initial.pricingTier = t.tier;
    initial.tierMargin = t.margin;
  }

  /* ---- travel estimate for the LOADED quote only (E3/E4, punch #89) ----
     This used to build an entry for every customer AND every venue in the
     directory. #84 fixed the query cost (thousands of serialized round trips
     → 2) but not the SIZE: measured against ~1,700 companies the map was
     5,100 entries, ~327 KiB of a ~1.05 MiB page payload — every byte of it
     to answer one lookup at a time.

     Both client consumers only ever read the current selection
     (`travelEstNow()`, and `reapplyAutoTrips()` called from the pickers with
     the id just chosen), so the client now fetches the rest on demand via
     travelForSelectionAction. What stays here is the seed: the estimate for
     whatever the quote already has loaded, so the first paint is correct
     with no round trip and no flash of a missing distance. */
  const lite = (
    e: { miles: number | null; minutes: number | null; office: Office | null } | null
  ): TravelLite => ({
    miles: e?.miles ?? null,
    minutes: e?.minutes ?? null,
    officeName: e?.office?.name ?? null,
  });
  const travel: Record<string, TravelLite> = {};
  if (initial.customerId) {
    travel[initial.customerId + "|" + (initial.locationId || "")] = lite(
      await travelForId(initial.customerId, initial.locationId || undefined)
    );
  } else if (initial.custName) {
    travel["name|" + initial.custName] = lite(await travelForName(initial.custName));
  }

  // #284: the next-step control (Submit for approval / Approve / Send …) —
  // it carries the #242 review-limit chip for the viewer as its strip.
  const next = q ? await quoteNextStepFor(q, user) : null;

  return (
    <>
    {/* #340: "Quote these findings" created this quote but couldn't link its findings. */}
    <ActionError message={one(sp.err)} />
    <EstimatorClient
      initial={initial}
      pipelines={pipelines}
      companyName={settings.companyName || "Peak Systems Group"}
      logoDark={settings.logoDark || null}
      fabrics={fabrics}
      curtainSewingPct={curtainSewingPct}
      trackSeries={trackSeries}
      trackParts={trackParts}
      laborRates={laborRates}
      fixtureRates={fixtureRates}
      // #246: every Assembly Builder kind — fixtures, systems and hardware.
      fixtureAssemblies={allAssembliesFrom(fixtures, catalogRows)}
      vendors={vendorNames}
      blobUploads={blobEnabled()}
      customers={customers}
      travel={travel}
      next={next}
      aiSource={aiSource}
      people={roster.map((u) => ({ id: u.id, name: u.name }))}
      quoteTasks={quoteTasks}
      templateSets={templateSets.map((s) => ({ id: s.id, name: s.name }))}
      assumptionLibrary={mergedConsultingAssumptions(settings.consultingAssumptions)}
      freightRule={freightRule}
      portalStatusError={portalStatusError}
      // #334 (D877): the Assist-draft banner — null unless an undismissed Assist draft.
      assistDraft={assistDraftViewOf(q)}
      // Spec records design §6: the Spec select's options, as plain strings.
      specKeys={systemMatchKeys(specRecords)}
      canApplyCredit={can("create", user.roles)}
      // #287 task B: the Lead estimator select — the viewer may always take
      // the quote; only an approver may hand it to someone else.
      viewerName={user.name}
      viewerCanApprove={can("approve", user.roles)}
      // Jeff 2026-10-15 #18: the people lock at the first send (approvers can still change them).
      peopleSentOnce={quoteSentOnce(q)}
      // Jeff 2026-10-15 #19: a draft's bonus lines follow Estimating Rules (the server re-derives them on save).
      bonusRates={await loadBonusRates()}
      // Phase 4: the review-comment permissions (add / resolve / delete).
      viewerRoles={user.roles}
      // #293: Save to library / intros — the Spec panel's audience (#205).
      canWriteNarrativeLibrary={can("create", user.roles)}
      // #293: the system-intro library for the narrative column's intro select.
      narrativeIntros={narrativeIntros}
      // #301: Reset to default in the preview's Cover & package block.
      notIncludedDefault={estimateOutputDefaults.notIncluded}
      // Estimate suggestion (spec 2026-10-13 §2): the Suggested BOM panel + its live parts.
      suggestion={suggestion.view}
      suggestionParts={suggestion.parts}
    />
    </>
  );
}
