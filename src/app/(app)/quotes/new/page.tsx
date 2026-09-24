import { requireUser } from "@/lib/session";
import { all as allCustomers, type CustomerDoc } from "@/lib/stores/customers";
import QuoteIntakeForm from "./intake-form";
import { isServiceType, type IntakeCustomer, type ServiceType } from "./types";

export const metadata = { title: "New quote — Quartzite-6" };

/**
 * Guided "new quote" intake — the landing screen behind the "+ New quote"
 * split menu (quotes/controls.tsx). Picks (or quick-creates) the customer,
 * venue and contact a quote is for, then hands off to the right builder
 * pre-seeded via ?customer= instead of the builder opening blank.
 *
 * /quotes/new?type=<system|flame_test|repair|inspection|consulting|rental>
 */
export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [, sp, customerDocs] = await Promise.all([requireUser(), searchParams, allCustomers()]);

  const rawType = Array.isArray(sp.type) ? sp.type[0] : sp.type;
  const initialType: ServiceType = isServiceType(rawType) ? rawType : "system";
  const requestedCustomer = Array.isArray(sp.customer) ? sp.customer[0] : sp.customer;
  const requestedName = Array.isArray(sp.name) ? sp.name[0] : sp.name;
  const requestedVenue = Array.isArray(sp.venue) ? sp.venue[0] : sp.venue;
  const requestedContact = Array.isArray(sp.contact) ? sp.contact[0] : sp.contact;
  const requestedReplaces = Array.isArray(sp.replaces) ? sp.replaces[0] : sp.replaces;

  const customers: IntakeCustomer[] = customerDocs
    .map((c: CustomerDoc) => ({
      id: c.id,
      name: c.name,
      type: c.type || "",
      locations: (c.locations || []).map((l) => ({
        id: l.id || "",
        label: l.label || "",
        city: l.city || "",
        state: l.state || "",
        primary: !!l.primary,
      })),
      contacts: (c.contacts || []).map((ct) => ({
        name: ct.name,
        role: ct.role || "",
        primary: !!ct.primary,
      })),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const initialCustomerId = customers.some((c) => c.id === requestedCustomer) ? requestedCustomer || "" : "";
  const initialCustomer = customers.find((c) => c.id === initialCustomerId);
  const initialVenueId = initialCustomer?.locations.some((l) => l.id === requestedVenue) ? requestedVenue || "" : "";
  const initialContactName = initialCustomer?.contacts.some((c) => c.name === requestedContact) ? requestedContact || "" : "";
  return (
    <QuoteIntakeForm
      customers={customers}
      initialType={initialType}
      initialCustomerId={initialCustomerId}
      initialName={requestedName || ""}
      initialVenueId={initialVenueId}
      initialContactName={initialContactName}
      initialReplaces={requestedReplaces || ""}
    />
  );
}
