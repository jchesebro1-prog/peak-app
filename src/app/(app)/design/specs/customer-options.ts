import { all as allCustomers } from "@/lib/stores/customers";
import type { CustomerComboboxOption } from "@/components/customer-combobox";

/**
 * #205 Phase B (T5) — the customer typeahead's options for the New spec form
 * and the builder header, built server-side so only the few fields the
 * combobox reads cross to the client (the book is ~1.7k companies). Same
 * detail/searchText recipe as the quote intake (quotes/new/intake-form.tsx).
 * Server-only (reads the customers store).
 */
export async function specCustomerOptions(): Promise<CustomerComboboxOption[]> {
  const customers = await allCustomers();
  return customers
    .map((c) => ({
      id: c.id,
      name: c.name,
      detail:
        [c.type, (c.locations || []).map((l) => l.label).filter(Boolean).slice(0, 3).join(" · ")].filter(Boolean).join(" — ") ||
        undefined,
      searchText: [
        ...(c.locations || []).map((l) => `${l.label || ""} ${l.city || ""} ${l.state || ""}`),
        ...(c.contacts || []).map((ct) => ct.name),
      ].join(" "),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
