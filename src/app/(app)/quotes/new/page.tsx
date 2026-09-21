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

  return <QuoteIntakeForm customers={customers} initialType={initialType} />;
}
