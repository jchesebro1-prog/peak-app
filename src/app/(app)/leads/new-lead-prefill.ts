import type { CustomerDoc } from "@/lib/stores/customers";

export type ExistingLeadCustomer = Pick<CustomerDoc, "id" | "name"> & {
  locations: Array<{ label: string; city: string; state: string; primary: boolean }>;
  contacts: Array<{ name: string; email?: string; phone?: string; primary: boolean }>;
};

export type NewLeadFormState = {
  org: string;
  contact: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  source: string;
  interest: string;
  owner: string;
  value: string;
  customerId?: string | null;
};

export function applyExistingCustomerToLeadForm(
  prev: NewLeadFormState,
  customer: ExistingLeadCustomer | null,
): NewLeadFormState {
  if (!customer) return { ...prev, customerId: null };
  const contact = customer.contacts.find((c) => c.primary) || customer.contacts[0] || null;
  const location = customer.locations.find((l) => l.primary) || customer.locations[0] || null;
  return {
    ...prev,
    customerId: customer.id,
    org: customer.name,
    contact: contact?.name || "",
    email: contact?.email || "",
    phone: contact?.phone || "",
    city: location?.city || "",
    state: location?.state || prev.state,
  };
}
