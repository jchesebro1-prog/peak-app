import { requireUser } from "@/lib/session";
import ActionError from "@/components/action-error";
import { all as allCustomers, type CustomerDoc } from "@/lib/stores/customers";
import { get as getQuote } from "@/lib/stores/quotes";
import {
  mergedConsultingPhases,
  type ConsultingQuotePayload,
} from "@/lib/stores/engagements";
import { mergedConsultingAssumptions } from "@/lib/consulting-stages";
import { getSettings, mergedConsultingDisciplines } from "@/lib/settings";
import {
  ConsultingQuoteBuilder,
  type BuilderCustomer,
  type BuilderInitial,
} from "./controls";
import { pickContactName, pickVenueId, readHandoff } from "@/app/(app)/quotes/new/handoff";

export const metadata = { title: "Consulting quote — Quartzite-6" };

/**
 * Consulting QUOTE builder (D90) — the lightweight fee-based sibling of the
 * service quote builders. The server component loads the customer directory
 * + the admin-editable phase menu and hands them to the client form;
 * Save re-validates and persists in actions.ts. Review / send / won live in
 * the Quotes hub (ordinary quote machinery). Deep-linked as
 * /design/engagements/quote?id=<quoteId> to edit, ?customer=<customerId> to start.
 */

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function ConsultingQuotePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, customerDocs, settings] = await Promise.all([
    requireUser(),
    searchParams,
    allCustomers(),
    getSettings(),
  ]);

  const editId = one(sp.id);
  const handoff = readHandoff(sp);
  const saved = one(sp.saved) === "1";
  const error = one(sp.err);

  const customers: BuilderCustomer[] = customerDocs.map((c: CustomerDoc) => ({
    id: c.id,
    name: c.name,
    locations: (c.locations || []).map((l) => ({
      id: l.id || "",
      label: l.label || "Venue",
    })),
    contacts: (c.contacts || []).map((ct) => ({
      name: ct.name,
      role: ct.role,
      email: ct.email,
      primary: !!ct.primary,
    })),
  }));

  const phaseMenu = mergedConsultingPhases(settings.consultingPhases);
  const assumptionsMenu = mergedConsultingAssumptions(settings.consultingAssumptions);
  const disciplineMenu = mergedConsultingDisciplines(settings.consultingDisciplines);

  let initial: BuilderInitial | null = null;
  if (editId) {
    const q = await getQuote(editId);
    if (q && q.quoteType === "consulting") {
      const pay = (q.consulting || null) as ConsultingQuotePayload | null;
      const contact =
        q.contact && typeof q.contact === "object"
          ? (q.contact as { name?: string; role?: string; email?: string })
          : null;
      initial = {
        id: q.id,
        name: q.name,
        customerId: q.customerId || "",
        venueCustomerId: pay?.venueCustomerId || q.customerId || "",
        locationId: q.locationId || "",
        contactName: contact?.name || "",
        contactRole: contact?.role || "",
        contactEmail: contact?.email || "",
        scopes: (pay?.scopes || []).map((s) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          fee: s.fee,
        })),
        assumptions: pay?.assumptions || [],
        legacyScope: pay?.scope || "",
        legacyFeeMode: pay?.feeMode === "milestones" ? "milestones" : "fixed",
        legacyFees: pay?.fees || [],
        terms: pay?.terms || "",
        phases: pay?.phases || [],
        disciplines: pay?.disciplines || [],
        status: q.status,
      };
    }
  }

  // #160: intake hand-off for a NEW proposal. The customer is both the billed
  // party and the venue owner until the user splits them, so the venue id is
  // validated against it. Consulting's existing fallback is blank (no primary
  // venue/contact auto-pick), so no fallback here either.
  const preCust = !editId ? customers.find((c) => c.id === handoff.customerId) || null : null;
  const pre = {
    customerId: preCust?.id || "",
    venueId: preCust ? pickVenueId(preCust, handoff.venueId, false) : "",
    contactName: preCust ? pickContactName(preCust, handoff.contactName, false) : "",
    name: preCust ? handoff.name : "",
    replaces: preCust ? handoff.replaces : "",
  };

  return (
    <>
      <ActionError message={error || undefined} />
      <ConsultingQuoteBuilder
        customers={customers}
        phaseMenu={phaseMenu}
        disciplineMenu={disciplineMenu}
        assumptionsMenu={assumptionsMenu}
        initial={initial}
        pre={pre}
        justSaved={saved}
      />
    </>
  );
}
