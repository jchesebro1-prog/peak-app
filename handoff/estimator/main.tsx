/**
 * Estimator handoff — entry. Until the browser store and the props builder land (Task 3),
 * this mounts the real EstimatorClient with props built from the slice's globals
 * (runtime/seed.ts), on the spike's fixed values. Opens `?id=` when the slice has it, else
 * the golden fixture Q-G001, else the first estimate. The root gets `data-handoff-ready`
 * after the first render (verify.ts waits for it).
 */
import "./shims/next-navigation"; // patch history before the app mounts
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import EstimatorClient from "@/app/(app)/estimator/estimator-client";
import type { CustomerLite, EstimatorProps, InitialQuote, SpecSection } from "@/app/(app)/estimator/types";
import type { QuoteReview } from "@/lib/stores/quotes";
import { DEFAULT_PIPELINES } from "@/lib/pipelines";
import { DEFAULT_FREIGHT_RULE } from "@/lib/freight-rule";
import { normalizePdfOptions } from "@/lib/quote-pdf/pdf-options";
import { normalizePackageSelection } from "@/lib/estimate-output/package-selection";
import { FIXTURE_RATE_DEFAULTS } from "@/lib/fixture-rates";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { documentRevStamp } from "@/lib/quote-pdf/state";
import { sourceForSave } from "@/lib/portal-quote-mode";
import { normalizeSystemOrder, sanitizeGroups } from "@/lib/estimate-groups/groups";
import { sanitizePackageDoc } from "@/lib/package-doc/sanitize";
import { seedCatalog, seedCustomers, seedEstimates, seedRules, seedTeam, type SeedEstimate } from "./runtime/seed";
import { onRefresh } from "./runtime/router";

const DEFAULT_ESTIMATE_ID = "Q-G001";

const rvNone = (): QuoteReview => ({ state: "none", reviewer: null, submittedBy: null, submittedAt: null, decidedBy: null, decidedAt: null, note: "" });

function pickEstimate(): SeedEstimate | null {
  const all = seedEstimates();
  const want = new URLSearchParams(window.location.search).get("id");
  return all.find((q) => q.id === want) ?? all.find((q) => q.id === DEFAULT_ESTIMATE_ID) ?? all[0] ?? null;
}

function customersFromSeed(): CustomerLite[] {
  const { companies, sites, contacts } = seedCustomers();
  return companies.map((c) => ({
    id: c.id,
    name: String(c.name ?? ""),
    locations: sites
      .filter((s) => s.companyId === c.id)
      .map((s) => ({ id: s.id, label: String(s.locationName || s.name || ""), city: String(s.city ?? ""), primary: !!s.isPrimary })),
    contacts: contacts
      .filter((ct) => ct.homeCompanyId === c.id)
      .map((ct) => ({ name: [ct.firstName, ct.lastName].filter(Boolean).join(" "), role: String(ct.title ?? ""), primary: !!ct.isPrimary })),
  }));
}

function initialFrom(q: SeedEstimate, customers: CustomerLite[]): InitialQuote {
  const crec = customers.find((c) => c.id === q.customerId) ?? null;
  const locationId = q.locationId || crec?.locations.find((l) => l.primary)?.id || crec?.locations[0]?.id || null;
  const groups = sanitizeGroups(q.spec?.groups);
  const sections = Array.isArray(q.spec?.sections) && q.spec.sections.length ? normalizeSystemOrder(q.spec.sections as SpecSection[], groups) : null;
  return {
    systemCategories: [],
    loadedId: q.id,
    quoteId: displayQuoteNumber(q),
    status: q.status ?? "draft",
    review: q.review || rvNone(),
    quoteType: q.quoteType ?? null,
    pipelineId: q.pipelineId ?? null,
    stage: q.stage ?? null,
    projectName: q.name || "New estimate",
    custName: crec?.name || q.customer || "",
    customerId: q.customerId ?? null,
    locationId,
    contactName: q.contactName || "",
    quoteNote: q.quoteNote ?? "",
    assumptions: q.assumptions ?? "",
    installTimeframe: q.installTimeframe || "TBD",
    paymentTerms: q.paymentTerms || "Unknown",
    category: q.category || "",
    owner: q.owner || "",
    preparedBy: q.preparedBy || "",
    revNum: documentRevStamp(q).revNum,
    revDateMs: q.updatedAt || Date.now(),
    pricingTier: q.pricingTier ?? null,
    tierMargin: q.tierMargin ?? null,
    sections,
    groups,
    document: sanitizePackageDoc(q.spec?.document),
    vendorQuotes: [],
    replaces: "",
    coverSummary: q.coverSummary || "",
    notIncluded: typeof q.notIncluded === "string" ? q.notIncluded : null,
    packageSelection: normalizePackageSelection(q.packageSelection),
    pdfOptions: normalizePdfOptions(q.pdfOptions),
    pdf: null,
    portal: null,
    bonusSource: sourceForSave(q.source, "estimator"),
    bonusQuoteType: q.quoteType ?? "system",
    clientResponses: null,
    bonusRecord: null,
    estimatorBonusSplit: null,
    leadId: null,
  };
}

function buildProps(q: SeedEstimate): EstimatorProps {
  const customers = customersFromSeed();
  const catalog = seedCatalog();
  const settings = seedRules().settings;
  const team = seedTeam();
  const laborRates: Record<string, number> = {};
  for (const p of catalog) if (p.category === "Labor" && p.sku) laborRates[p.sku] = Number(p.cost) || 0;
  const vendors = [...new Set(catalog.map((p) => (p.mfr || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const viewer = team.find((u) => u.roles?.includes("admin")) ?? team[0];
  const viewerName = viewer?.name ?? "Peak estimator";
  return {
    initial: initialFrom(q, customers),
    vendorFromThread: null,
    pipelines: DEFAULT_PIPELINES,
    companyName: typeof settings.companyName === "string" ? settings.companyName : "Peak Systems Group",
    logoDark: typeof settings.logoDark === "string" ? settings.logoDark : null,
    fabrics: [],
    curtainSewingPct: 10,
    trackSeries: [],
    trackParts: {},
    laborRates,
    fixtureRates: { ...FIXTURE_RATE_DEFAULTS },
    fixtureAssemblies: [],
    vendors,
    blobUploads: false,
    customers,
    travel: {},
    next: null,
    aiSource: null,
    people: team.map((u) => ({ id: u.id, name: u.name })),
    quoteTasks: [],
    templateSets: [],
    freightRule: DEFAULT_FREIGHT_RULE,
    assumptionLibrary: [],
    portalStatusError: null,
    assistDraft: null,
    specKeys: [],
    canApplyCredit: false,
    viewerName,
    viewerCanApprove: true,
    peopleSentOnce: false,
    viewerRoles: viewer?.roles ?? ["admin"],
    canWriteNarrativeLibrary: true,
    narrativeIntros: [],
    notIncludedDefault: "",
    suggestion: null,
    suggestionParts: {},
    vendorPdfEnabled: false,
  };
}

const bannerStyle = {
  padding: "4px 12px",
  font: "600 12px/1.6 var(--font-ui)",
  letterSpacing: "0.02em",
  background: "#16181b",
  color: "#e8e3d8",
} as const;

function App() {
  const [q] = useState(pickEstimate);
  const [props, setProps] = useState(() => (q ? buildProps(q) : null));
  // router.refresh() → re-read the props (state in the client tree is kept, as with a server re-render).
  useEffect(() => (q ? onRefresh(() => setProps(buildProps(q))) : undefined), [q]);
  useEffect(() => {
    document.getElementById("root")?.setAttribute("data-handoff-ready", "");
  }, []);
  return (
    <>
      <div style={bannerStyle} data-handoff-banner="">
        Confidential — Peak Systems Group · prototype — nothing is sent or saved to Peak
      </div>
      {props ? (
        <EstimatorClient {...props} />
      ) : (
        <p style={{ padding: 24 }}>No estimates in this build — run npm run handoff:slice, then npm run handoff:build.</p>
      )}
    </>
  );
}

const el = document.getElementById("root");
if (!el) throw new Error("#root is missing from index.html");
createRoot(el, {
  // Log the component stack, then report as React would by default (a pageerror — verify.ts fails on it).
  onUncaughtError: (e, info) => {
    console.error("[handoff] uncaught render error", info?.componentStack);
    window.reportError(e);
  },
}).render(<App />);
