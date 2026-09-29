import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { get as getQuote, type Quote, type QuoteReview } from "@/lib/stores/quotes";
import { quoteBuilderHref, estimatorShouldRedirect } from "@/lib/quote-links";
import { byCategory, fabricParts, list as catalogList } from "@/lib/stores/catalog";
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
import { reviewers as reviewerUsers, activeUsers } from "@/lib/users";
import { getSettings, type Office } from "@/lib/settings";
import { loadPipelines } from "@/lib/pipelines-server";
import { get as getSurvey } from "@/lib/stores/surveys";
import { get as getInspection } from "@/lib/stores/inspections";
import { getFixtureRates, loadCurtainSewingPct } from "@/lib/stores/pricing";
import { loadFreightRule } from "@/lib/freight-rule-load";
import { allSpecRecords } from "@/lib/stores/spec-records";
import { systemMatchKeys } from "@/lib/specs/records";
import { blobEnabled } from "@/lib/blob";
import { DEFAULT_PDF_OPTIONS, normalizePdfOptions } from "@/lib/quote-pdf/pdf-options";
import { tasksForQuote } from "@/lib/stores/tasks";
import { resolveTier } from "@/lib/pricing-tiers";
import { taskTemplateSetsFor } from "@/lib/stores/task-templates";
import { pickContactName, pickVenueId, readHandoff, systemQuoteName } from "@/app/(app)/quotes/new/handoff";
import { mergedConsultingAssumptions } from "@/lib/consulting-stages";
import { pdfView } from "@/lib/quote-pdf/state";
import EstimatorClient from "./estimator-client";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { reviewLimitChipFor } from "@/lib/review-limits-server";
import type {
  AiSource,
  CustomerLite,
  InitialQuote,
  PaymentTerms,
  SpecSection,
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
  spec?: { sections?: unknown; mobs?: unknown } | null;
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
  userName: string
): Promise<InitialQuote> {
  if (!q) {
    return {
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
      revNum: 1,
      revDateMs: Date.now(),
      pricingTier: null,
      tierMargin: null,
      sections: null,
      vendorQuotes: [],
      replaces: "",
      pdfOptions: { ...DEFAULT_PDF_OPTIONS },
      pdf: null,
      portal: null,
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
  const sections =
    spec && Array.isArray(spec.sections) && spec.sections.length
      ? (spec.sections as SpecSection[])
      : null;
  return {
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
    owner: q.owner || userName,
    // Real priced revisions (item 24). This used to count `history`, which is
    // the status pipeline — so the printed "Rev N" climbed every time a quote
    // moved draft → sent → won, with no revision having been taken.
    revNum: Math.max(1, q.revisions?.length || 1),
    revDateMs: q.updatedAt || Date.now(),
    // Item 11 (D87): stamped tier seeds labor/curtain margins client-side.
    pricingTier: q.pricingTier ?? null,
    tierMargin: q.tierMargin ?? null,
    sections,
    vendorQuotes: vendorQuotesOf(q),
    replaces: "",
    pdfOptions: normalizePdfOptions(q.pdfOptions),
    pdf: pdfView(q.pdf, Date.now()),
    // #245 Task 13: the staff Portal panel — present only for a portal-
    // catalog quote. porItems is a point-in-time read of the loaded spec's
    // `por` lines; the next Save recomputes what remains (clearPricedPor).
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

  const [fabricRows, laborRows, customerDocs, reviewerRows, settings, fixtureRates, roster, catalogRows, pipelines, fixtures, curtainSewingPct, freightRule, specRecords] =
    await Promise.all([
      fabricParts(),
      byCategory("Labor"),
      allCustomers(),
      reviewerUsers(),
      getSettings(),
      getFixtureRates(),
      activeUsers(),
      catalogList(),
      loadPipelines(),
      listFixtures(),
      loadCurtainSewingPct(),
      loadFreightRule(),
      allSpecRecords(),
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

  const initial = await initialFrom(q, customers, user.name);

  // Seed the customer/venue/contact picked in the guided intake (quotes/new).
  // A venue/contact not on the customer falls back to its primary (#160).
  if (preCustomer) {
    const cust = customers.find((c) => c.id === preCustomer);
    if (cust) {
      initial.customerId = cust.id;
      initial.custName = cust.name;
      initial.locationId = pickVenueId(cust, handoff?.venueId || "") || null;
      initial.contactName = pickContactName(cust, handoff?.contactName || "");
    }
  }
  if (preCategory && preCategory.trim()) initial.category = preCategory.trim();
  if (handoff) {
    // #160: the intake's optional name, else "<Customer> — System" (or
    // "— <category>") instead of the old static "New estimate".
    initial.projectName = handoff.name || (initial.customerId ? systemQuoteName(initial.custName, initial.category) : initial.projectName);
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

  // #242: the owner's review-limit chip for the saved quote (none for a new one).
  const reviewLimit = q ? await reviewLimitChipFor(q, user.name) : null;

  return (
    <EstimatorClient
      initial={initial}
      pipelines={pipelines}
      companyName={settings.companyName || "Peak Systems Group"}
      logoDark={settings.logoDark || null}
      fabrics={fabrics}
      curtainSewingPct={curtainSewingPct}
      laborRates={laborRates}
      fixtureRates={fixtureRates}
      // #246: every Assembly Builder kind — fixtures, systems and hardware.
      fixtureAssemblies={allAssembliesFrom(fixtures, catalogRows)}
      vendors={vendorNames}
      blobUploads={blobEnabled()}
      customers={customers}
      travel={travel}
      reviewers={reviewerRows.map((u) => u.name)}
      me={user.name}
      canApprove={can("approve", user.roles)}
      reviewLimit={reviewLimit}
      aiSource={aiSource}
      people={roster.map((u) => ({ id: u.id, name: u.name }))}
      quoteTasks={quoteTasks}
      templateSets={templateSets.map((s) => ({ id: s.id, name: s.name }))}
      assumptionLibrary={mergedConsultingAssumptions(settings.consultingAssumptions)}
      freightRule={freightRule}
      portalStatusError={portalStatusError}
      // Spec records design §6: the Spec select's options, as plain strings.
      specKeys={systemMatchKeys(specRecords)}
    />
  );
}
