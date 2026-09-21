import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { get as getQuote, type Quote, type QuoteReview } from "@/lib/stores/quotes";
import { byCategory, list as catalogList } from "@/lib/stores/catalog";
import { resolveFixtureAssemblies } from "@/lib/fixture-assemblies";
import {
  all as allCustomers,
  resolveId,
  travelForId,
  travelForName,
  type CustomerDoc,
} from "@/lib/stores/customers";
import { reviewers as reviewerUsers, activeUsers } from "@/lib/users";
import { getSettings, type Office } from "@/lib/settings";
import { get as getSurvey } from "@/lib/stores/surveys";
import { get as getInspection } from "@/lib/stores/inspections";
import { getFixtureRates } from "@/lib/stores/pricing";
import { tasksForQuote } from "@/lib/stores/tasks";
import EstimatorClient from "./estimator-client";
import type {
  AiSource,
  CustomerLite,
  InitialQuote,
  PaymentTerms,
  SpecSection,
  TravelLite,
} from "./types";

export const metadata = { title: "Estimator — Quartzite-6" };

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
};

type QuoteDoc = Quote & {
  contactName?: string;
  quoteNote?: string;
  paymentTerms?: PaymentTerms;
  spec?: { sections?: unknown; mobs?: unknown } | null;
};

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
      projectName: FALLBACK.projectName,
      custName: FALLBACK.custName,
      customerId: null,
      locationId: null,
      contactName: "",
      quoteNote: FALLBACK.quoteNote,
      paymentTerms: "Unknown",
      owner: userName,
      revNum: 1,
      revDateMs: Date.now(),
      pricingTier: null,
      tierMargin: null,
      sections: null,
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
    quoteId: q.id,
    status: q.status,
    review: q.review || rvNone(),
    projectName: q.name || FALLBACK.projectName,
    custName: cname,
    customerId: cid,
    locationId: locId,
    contactName: contactName || "",
    quoteNote: q.quoteNote != null ? q.quoteNote : FALLBACK.quoteNote,
    paymentTerms: q.paymentTerms || "Unknown",
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
  // Guided intake hand-off (quotes/new): only applies to a fresh builder —
  // an explicit ?id= always wins.
  const preCustomer = rawId ? undefined : one(sp.customer);

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

  const [fabricRows, laborRows, customerDocs, reviewerRows, settings, fixtureRates, roster, catalogRows] =
    await Promise.all([
      byCategory("Fabric"),
      byCategory("Labor"),
      allCustomers(),
      reviewerUsers(),
      getSettings(),
      getFixtureRates(),
      activeUsers(),
      catalogList(),
    ]);
  // PUNCHLIST #17 remainder — this quote's tasks (empty until the quote is
  // saved once; q.id is only real once a doc exists to key tasks off of).
  const quoteTasks = q ? await tasksForQuote(q.id) : [];

  // Only catalog fabrics with a real per-sq-ft basis feed the curtain
  // configurator — imported vendor fabric rows (priced per unit, no costPerSqft)
  // would otherwise show up as $0/sq ft options.
  const fabrics = fabricRows
    .filter((p) => (p.costPerSqft ?? 0) > 0)
    .map((p) => ({
      sku: p.sku,
      name: p.desc,
      costPerSqft: p.costPerSqft ?? 0,
      curtainAreaRate: p.curtainAreaRate,
    }));
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

  // Seed the customer/venue/contact picked in the guided intake screen
  // (quotes/new) — venue/contact default to the customer's primary, same
  // as repairs/quote's preCustomer handling.
  if (preCustomer) {
    const cust = customers.find((c) => c.id === preCustomer);
    if (cust) {
      const prim = cust.locations.find((l) => l.primary) || cust.locations[0] || null;
      const primaryContact = cust.contacts.find((c) => c.primary) || cust.contacts[0] || null;
      initial.customerId = cust.id;
      initial.custName = cust.name;
      initial.locationId = prim?.id || null;
      initial.contactName = primaryContact?.name || "";
    }
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

  return (
    <EstimatorClient
      initial={initial}
      companyName={settings.companyName || "Peak Systems Group"}
      logoDark={settings.logoDark || null}
      fabrics={fabrics}
      laborRates={laborRates}
      fixtureRates={fixtureRates}
      fixtureAssemblies={resolveFixtureAssemblies(settings.fixtureAssemblies, catalogRows)}
      customers={customers}
      travel={travel}
      reviewers={reviewerRows.map((u) => u.name)}
      me={user.name}
      canApprove={can("approve", user.roles)}
      aiSource={aiSource}
      people={roster.map((u) => ({ id: u.id, name: u.name }))}
      quoteTasks={quoteTasks}
    />
  );
}
