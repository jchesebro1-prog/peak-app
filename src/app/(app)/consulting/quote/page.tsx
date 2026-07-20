import { requireUser } from "@/lib/session";
import { all as allCustomers, type CustomerDoc } from "@/lib/stores/customers";
import { get as getQuote } from "@/lib/stores/quotes";
import {
  mergedConsultingPhases,
  type ConsultingQuotePayload,
} from "@/lib/stores/engagements";
import { getSettings } from "@/lib/settings";
import {
  ConsultingQuoteBuilder,
  type BuilderCustomer,
  type BuilderInitial,
} from "./controls";

export const metadata = { title: "Consulting quote — Peak Backend" };

/**
 * Consulting QUOTE builder (D90) — the lightweight fee-based sibling of the
 * service quote builders. The server component loads the customer directory
 * + the admin-editable phase menu and hands them to the client form;
 * Save re-validates and persists in actions.ts. Review / send / won live in
 * the Quotes hub (ordinary quote machinery). Deep-linked as
 * /consulting/quote?id=<quoteId> to edit, ?customer=<customerId> to start.
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
  const preCustomer = one(sp.customer);
  const saved = one(sp.saved) === "1";

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
        locationId: q.locationId || "",
        contactName: contact?.name || "",
        contactRole: contact?.role || "",
        contactEmail: contact?.email || "",
        scope: pay?.scope || "",
        feeMode: pay?.feeMode === "milestones" ? "milestones" : "fixed",
        fees: pay?.fees || [],
        terms: pay?.terms || "",
        phases: pay?.phases || [],
        status: q.status,
      };
    }
  }

  return (
    <ConsultingQuoteBuilder
      customers={customers}
      phaseMenu={phaseMenu}
      initial={initial}
      preCustomerId={preCustomer}
      justSaved={saved}
    />
  );
}
